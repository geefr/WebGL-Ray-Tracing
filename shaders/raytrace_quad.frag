#version 300 es

precision highp float;

// Performance profiling hacks
#define PERF_BENCH

#ifndef PERF_BENCH
// Enable error indicators
// - Diagonal red stripes: Intersections aren't sorted / depth ordering problem
// #define DEBUG

// Enable features
//#define ENABLE_SHADOWS
//#define ENABLE_REFLECTIONS
// #define ENABLE_TRANSPARENCY
// TODO: Patterns need some work - Would be extended to texture support or similar
#define ENABLE_PATTERNS

#endif // PERF_BENCH


#define PI 3.1415926538

in vec3 fragPos;
in vec2 vUV;

// width pixels, height pixels, fov(rad), nearz
uniform vec4 viewParams;

uniform mat4 viewMatrix;

// A primitive / object
// - modelMatrix
// - meta.x - The type
//   - 1 - Sphere, at 0,0,0, radius = 1
//   - 2 - The XZ Plane
//   - If more types added update compute_intersection_data, mainImage, and any other places is_sphere is called
// - meta.y - Material index from ubo_0.materials
// - meta.z - Material pattern type
// - meta.w - Unused
//
// Pattern types
// - 0.0: disabled
// - 1.0: stripes/dots. Pattern.xy -> Multiplier for x/y coords. 0.0 to disable axis, 1.0 to get gradient. Gradient applied to ambient and diffuse.
struct Primitive {
  mat4 modelMatrix;
  vec4 meta;
  vec4 pattern;
  vec4 pad2;
  vec4 pad3;
};

struct Light {
  vec4 intensity;  // rgb_
  vec4 position;   // xyz1 (TODO: Support for directional lights)
  vec4 shadow;     // Cast shadows if x != 0.0, yzw unused
  vec4 pad;
};

struct Material {
  vec4 ambient;    // rgba
  vec4 diffuse;    // rgba
  vec4 specular;   // rgbs, s=shininess
  vec4 phys;       // rti_, r=reflectivity, t=transparency, i=refractive index
};

// Upper limits for scene objects
const int max_iNumPrimitives = 20;
const int max_iNumMaterials = 8;
// THERE ARE FOUR LIGHTS!
const int max_iNumLights = 4;

uniform int iNumPrimitives;
uniform int iNumMaterials;
uniform int iNumLights;
// This block only contains the primitives, to simplify the buffer upload in js
layout (std140) uniform ubo_0
{
  Light lights[max_iNumLights];
  Material materials[max_iNumMaterials];
  Primitive primitives[max_iNumPrimitives];
} ;

out vec4 fragColor;

/////////////////////////////////////////////////////////////////////////////////////////////////
//// Limits and constants
// The maximum number of intersections for a single ray (Because glsl can't have dynamic arrays)
// TODO: PERF: Limiting this makes a huge difference on performance, but is that just because we don't so as many reflections?
// Nope! With just phong shading having this at 20 is 5 times worse than having it at 10. At just 6 it's then twice as good as 10 easily.
// Maybe this is to do with memory usage during the shader? We need a list of intersections somehow don't we?
const int limit_in_per_ray_max = 6;
const int limit_reflection_depth = 4;
const int limit_transparency_depth = 10;
const float limit_inf = 1e20; // Could use 1.0 / 0.0, but nvidia optimises using uintBitsToFloat, which requires version 330
const float limit_float_max = 1e19;
const float limit_epsilon = 1e-12;
const float limit_acne_factor = 1e-3;

//// Data Types (That aren't uniforms)
// A ray, starting at origin, travelling along direction
struct Ray {
  vec4 origin;
  vec4 direction;
};

// An intersection between a ray and primitive(i) at (t)
// (The closest of a set of intersections is referred to as the 'hit')
struct Intersection {
  float t;     // Intersection distance (along current ray)
  int i;       // primitive index
  bool inside; // true if intersection is within an object (Ray going from inside -> outside)
  vec4 pos;    // Intersection position
  vec4 eye;    // Intersection -> eye vector
  vec4 normal; // Intersection normal
  vec4 ray_reflect; // Direction of reflected ray
  vec2 uv;     // Intersection texture coord on primitive
};



/////////////////////////////////////////////////////////////////////////////////////////////////
// A fixed-length segmented array for storing intersections
// Stores data for intersections along a ray, up to a maximum length (say, 100m or so)
// Data is always sorted in ascending t
// If there are 2 intersections close enough to be in the same cell the last intersection written will win

const int IntersectArray_max_divisions = 1024;
const float IntersectArray_maxT = 100.0;
const int IntersectArray_max_intersections = 10;
const float IntersectArray_cellSize = IntersectArray_maxT / float(IntersectArray_max_divisions);
struct IntersectArray
{  
  float t_min;
  float t_max;
  int num_stored;
  int first_i;
  int last_i;
  int arr_indices[IntersectArray_max_divisions];

  Intersection arr_intersections[IntersectArray_max_intersections];
  int arr_intersections_insert;
};
IntersectArray IntersectArray_init() {
  IntersectArray self;
  self.t_min = IntersectArray_maxT;
  self.t_max = 0.0;
  self.num_stored = 0;
  self.first_i = -1;
  self.last_i = -1;
  for( int i = 0; i < IntersectArray_max_divisions; i++ ) {
    self.arr_indices[i] = -1;
  }
  // for( int i = 0; i < IntersectArray_max_intersections; i++ ) {
  //   self.arr_intersections[i].t = limit_inf;
  // }
  self.arr_intersections_insert = 0;
  return self;
}
bool IntersectArray_put( inout IntersectArray self, in Intersection intersection ) {
  if( intersection.t < 0.0 || intersection.t > IntersectArray_maxT ) return false;

  int i = int( intersection.t / IntersectArray_cellSize );

  int existing_index = self.arr_indices[i];
  if( existing_index == -1 ) {
    self.arr_intersections[self.arr_intersections_insert] = intersection;
    self.arr_indices[i] = self.arr_intersections_insert;
    self.arr_intersections_insert++;
    self.num_stored++;
  }
  else {
    self.arr_intersections[existing_index] = intersection;
  }

  if( intersection.t < self.t_min ) {
    self.first_i = i;
    self.t_min = intersection.t;
  }
  if( intersection.t > self.t_max ) {
    self.last_i = i;
    self.t_max = intersection.t;
  }
  return true;
}
bool IntersectArray_get( in IntersectArray self, float t, out Intersection intersection ) {
  if( t < 0.0 || t > IntersectArray_maxT ) return false;

  int i = int( t / IntersectArray_cellSize );
  if( self.arr_indices[i] == -1 ) return false;
  intersection = self.arr_intersections[self.arr_indices[i]];
  return true;
}
bool IntersectArray_first( in IntersectArray self, out int i, out Intersection intersection ) {
  if( self.first_i == -1 ) return false;
  intersection = self.arr_intersections[self.arr_indices[self.first_i]];
  i = self.first_i;
  return true;
}
bool IntersectArray_next( in IntersectArray self, inout int i, out Intersection intersection ) {
  i = max(i, self.first_i);
  while( i < IntersectArray_max_divisions && self.arr_indices[i] == -1 ) i++;
  if( i == IntersectArray_max_divisions ) return false;
  intersection = self.arr_intersections[self.arr_indices[i]];
  return true;
}
/////////////////////////////////////////////////////////////////////////////////////////////////

//// Ray functions
vec4 ray_to_position(Ray r, float t) { return r.origin + (r.direction * t); }

Ray ray_tf_world_to_model(Ray r, mat4 modelMatrix) { 
  // Transform a ray from world space to model space (inverse of modelMatrix)
  // Note that direction is left unnormalised - So that direction * t functions correctly
  mat4 m = inverse(modelMatrix);
  Ray rt;
  rt.origin = m * r.origin;
  rt.direction = m * r.direction;
  return rt;
}
/////////////////////////////////////////////////////////////////////////////////////////////////
// Primitive Functions - Utility methods for primitive, plus intersections
Material primitive_material(int i) { return materials[int(primitives[i].meta.y)]; }

#ifdef ENABLE_PATTERNS
vec4 pattern_stripedots(vec4 c, vec2 uv, vec4 pattern) {
  float x_mult = pattern.x;
  float y_mult = pattern.y;
  float x_mix = sin(uv.x * x_mult);
  float y_mix = sin(uv.y * y_mult);
  vec4 result = vec4(0.0, 0.0, 0.0, 1.0);

  if( x_mult > 0.0 ) {
    result += mix(vec4(0.0, 0.0, 0.0, 1.0), c, x_mix);
  }
  if( y_mult > 0.0 ) {
    result += mix(vec4(0.0, 0.0, 0.0, 1.0), c, y_mix);
  }
  if( x_mult > 0.0 && y_mult > 0.0 ) {
    result /= 2.0;
  }
  return result;
}

// Apply a pattern to a given colour
vec4 primitive_pattern(int i, vec4 c, vec2 uv) {
  if( primitives[i].meta.z == 1.0 ) {
    return pattern_stripedots(c, uv, primitives[i].pattern);
  }
  return c;
}
#endif

/////////////////////////////////////////////////////////////////////////////////////////////////
// Sphere functions
bool is_sphere(int i) { return primitives[i].meta.x == 1.0; }

// Intersection of ray with the sphere at primitives[i]
// - ray: A ray in world space (oh rayray, mommy misses you D:)
// - intersections array will be populated with t
// - Will return the number of intersections
// wiki/Line-sphere_intersection
int sphere_intersect(int i, Ray ray, out Intersection[2] intersections) {
  // pull ray into model space, rest of calculation is for sphere(o=0,0,0 r=1)
  Ray r = ray_tf_world_to_model(ray, primitives[i].modelMatrix);

  // Calculate Determinant - If negative it's a miss
  vec4 sphere_to_ray = r.origin - vec4(0.0, 0.0, 0.0, 1.0);
  float a = dot(r.direction, r.direction);
  float b = 2.0 * dot(r.direction, sphere_to_ray);
  float c = dot(sphere_to_ray, sphere_to_ray) - 1.0;
  float discriminant = (b * b) - (4.0 * a * c);
  if( discriminant < 0.0 ) {
    // Miss
    return 0;
  }

  // Hit
  float t1 = (-b - sqrt(discriminant)) / (2.0 * a);
  float t2 = (-b + sqrt(discriminant)) / (2.0 * a);

  int num_intersections = 0;
  intersections[0].i = i; intersections[1].i = i;
  if( abs(t1 - t2) < limit_epsilon ) { intersections[0].t = t1; intersections[1].t = t2; num_intersections = 1; }
  else if( t1 < t2 ) { intersections[0].t = t1; intersections[1].t = t2; num_intersections = 2; }
  else if( t2 < t1 ) { intersections[0].t = t2; intersections[1].t = t1; num_intersections = 2; }

  // Calculate uv
  // TODO: PERF: Duplicate calculation of p
  vec4 p0 = ray_to_position(r, t1);
  vec2 uv0;
  uv0.y = acos(p0.x / p0.y);
  uv0.x = acos(p0.y);
  intersections[0].uv = uv0;

  vec4 p1 = ray_to_position(r, t2);
  vec2 uv1;
  uv1.y = acos(p1.x / p1.y);
  uv1.x = acos(p1.y);
  intersections[1].uv = uv1;

  return num_intersections;
}

// Surface normal for sphere at point p (on surface of sphere, in world space)
vec4 sphere_normal(int i, vec4 p) {
  mat4 m = primitives[i].modelMatrix;
  vec4 pm = inverse(m) * p;
  vec4 n = pm - vec4(0.0, 0.0, 0.0, 1.0);
  // Technically should use sub(m,3,3), but zeroing w afterwards is easier
  n = transpose(inverse(m)) * n; 
  n.w = 0.0;
  return normalize(n);
}

// Plane functions
bool is_plane_xz(int i) { return primitives[i].meta.x == 2.0; }

// Intersection of ray with the xz plane
// - ray: A ray in world space
bool plane_xz_intersect(int i, Ray ray, out Intersection intersection) {
  Ray r = ray_tf_world_to_model(ray, primitives[i].modelMatrix);

  // Rays parallel to the surface can't intersect
  // Coplanar rays intersect an infinite amount
  if( abs(r.direction.y) < limit_epsilon ) {
    return false;
  }

  float t = (- r.origin.y) / r.direction.y;
  intersection.i = i;
  intersection.t = t;

  // Calculate uv
  // TODO: PERF: Duplicate calculation of p
  // This is an infinite plane, so tile around 10x10
  vec4 p = ray_to_position(r, t);
  intersection.uv.x = p.x / 10.0;
  intersection.uv.y = p.z / 10.0;

  return true;
}

vec4 plane_xz_normal(int i) {
  mat4 m = primitives[i].modelMatrix;
  vec4 n = vec4(0.0, 1.0, 0.0, 0.0);
  n = transpose(inverse(m)) * n; 
  n.w = 0.0;
  return normalize(n);
}

/////////////////////////////////////////////////////////////////////////////////////////////////
//// Utility functions
// Common vector calculations
vec4 vector_eye( vec4 p, vec4 eye ) { return normalize(eye - p); }
vec4 vector_light( vec4 p, Light l ) { return normalize(l.position - p); }
vec4 vector_light_reflected( vec4 i, vec4 n ) { return normalize(reflect(-i, n)); }

// Initialise intersections to insane values (t=inf)

// int closest_intersection( inout Intersection[limit_in_per_ray_max] intersections, int min_i, int max_i ) {
//   int smallest_i = limit_in_per_ray_max + 1;
//   float smallest_t = limit_inf;
//   for( int i = min_i; i < max_i; i++ ) {
//     if( intersections[i].t < smallest_t ) {
//       smallest_t = intersections[i].t;
//       smallest_i = i;
//     }
//   }
//   return smallest_i;
// }

// void sort_intersections( inout Intersection[limit_in_per_ray_max] intersections ) {
//   for( int out_i = 0; out_i < limit_in_per_ray_max; out_i++ ) {
//     int closest_i = closest_intersection(intersections, out_i, limit_in_per_ray_max);

//     // If the closest intersection is at infinity then there's no point continuing
//     // everything remaining in the array is useless
//     if( intersections[closest_i].t == limit_inf ) {
//       for( ; out_i < limit_in_per_ray_max; out_i++ ) {
//         intersections[out_i].t = limit_inf;
//       }
//       return;
//     }
//   }
// }

// // Sorted insert on intersection array, discard any overflow
// void intersection_insert( inout Intersection[limit_in_per_ray_max] intersections, Intersection new_intersect) {
//   // Check if it's not out of range already
//   if( intersections[limit_in_per_ray_max - 1].t < new_intersect.t
//    || new_intersect.t < 0.0 )
//   {
//     return;
//   }

//   // Find where to insert the new intersection
//   int i = 0;
//   while( intersections[i].t < new_intersect.t && i < limit_in_per_ray_max ) i++;

//   // Don't need to shuffle anything - This intersect and any after are nulls
//   if( intersections[i].t == limit_inf ) {
//     intersections[i] = new_intersect;
//     return;
//   }

//   // There's already an intersection where we want to insert
//   // Walk down from the end of the array and shuffle any non-nulls to the right
//   int j = limit_in_per_ray_max - 1;
//   while( j > i + 1 && intersections[j].t == limit_inf ) j--;
//   for( ; j > i; j-- ) {
//     intersections[j] = intersections[j-1];
//   }
//   // Made a gap, insert the intersection
//   intersections[i] = new_intersect;  
// }

// Perform ray intersection with every primitive
void ray_intersect_all( Ray r, inout IntersectArray arr ) {
  //int intersections_insert = 0;

  // Intersect with each primitive
  for( int i = 0; i < iNumPrimitives; i++ ) {
    if( is_sphere(i) ) {
      Intersection sphere_intersections[2];
      int ints = sphere_intersect(i, r, sphere_intersections);

      for( int j = 0; j < ints; j++ ) {
        IntersectArray_put(arr, sphere_intersections[j]);

        //intersection_insert(intersections, sphere_intersections[j]);

        //intersections[intersections_insert] = sphere_intersections[j];
        //intersections_insert++;
      }
    }
    else if( is_plane_xz(i) ) {
      Intersection plane_intersection;
      if( plane_xz_intersect(i, r, plane_intersection) ) {
        IntersectArray_put(arr, plane_intersection);
        //intersection_insert(intersections, plane_intersection);

        //intersections[intersections_insert] = plane_intersection;
        //intersections_insert++;
      }
    }
  }

  //sort_intersections(intersections);
}

// Determine which intersection is the 'hit' - Smallest non-negative t
// Requires that intersections be sorted before calling
// if allow_inside == true both inner and outer surfaces will be returned
bool get_hit_sorted( Intersection[limit_in_per_ray_max] intersections, out Intersection hit, bool allow_inside, bool allow_self, int self_i, out int hit_index ) {
  for( int i = 0; i < limit_in_per_ray_max; i++ ) {
    hit = intersections[i];

    if( allow_self == false &&
        hit.i == self_i ) {
          continue;
    }

    if( hit.t == limit_inf ||
        hit.t < 0.0 ) {
          // Invalid, or behind the ray's origin
          continue;
    }

    if( allow_inside == false &&
        hit.inside   == true ) {
          continue;
    }

    // This is the first valid intersection on the ray
    hit_index = i;
    return true;
  }
  return false;
}

// Pre-compute common vectors used during shading, fill in gaps in existing hit
// Unless this has been called an intersection's data for these will be undefined
void compute_intersection_data( Ray r, inout Intersection i ) {
  i.pos = ray_to_position(r, i.t);
  i.eye = vector_eye(i.pos, r.origin);

  if( is_sphere(i.i) ) {
    i.normal = sphere_normal(i.i, i.pos);
  }
  else if( is_plane_xz(i.i) ) {
    i.normal = plane_xz_normal(i.i);
  }
  else {
    // An error. Hopefully this looks strange enough to trigger investigation :)
    i.normal = vec4(1.0, 0.0, 0.0, 0.0);
  }

  // If the intersection is inside an object flip the normal
  if( dot(i.normal, i.eye) < 0.0 ) {
    i.normal = - i.normal;
    i.inside = true;
  } else {
    i.inside = false;
  }

  i.ray_reflect = reflect(r.direction, i.normal);
  // Note: DO NOT compute shadows in here unless you want infinite recursion in your shader ;)
}

void IntersectArray_compute_data_all( inout IntersectArray self, Ray r ) {
  if( self.first_i == -1 || self.last_i == -1 ) return;
  for( int i = self.first_i; i < self.last_i; i++ ) {
    if( self.arr_indices[i] != -1 ) {
      compute_intersection_data(r, self.arr_intersections[self.arr_indices[i]]);
    }
  }
}

// Compute whether a shadow is cast for a given intersection & light
// Note: previous attempt pre-calculated this for the intersection,
// but required assignment to element in array (intersection.shadow_casters[i])
// Turns out that's a problem causes https://stackoverflow.com/questions/60984733/warning-x3550-array-reference-cannot-be-used-as-an-l-value
//
// PERF: Shadows are expensive
bool compute_shadow_cast( Intersection intersection, Light l ) {
#ifdef ENABLE_SHADOWS
  if( l.shadow.x == 0.0 ) {
    // This light doesn't cast shadows, skip
    return false;
  }

  // Okay, need to check for shadow, down the performance hole we go!
  // Distance from intersection to light - If a hit is closer than this along
  // our ray then an object is causing a shadow.
  float l_distance = distance(intersection.pos, l.position);

  Ray shadow_ray;
  shadow_ray.origin = intersection.pos + (limit_acne_factor * intersection.normal);
  shadow_ray.direction = vector_light(intersection.pos, l);

  Intersection shadow_intersections[limit_in_per_ray_max];
  ray_intersect_all(shadow_ray, shadow_intersections);
  // TODO: PERF: Noticed we don't sort the intersections here at all. would it be faster if we did?

  for( int i = 0; i < limit_in_per_ray_max; i++ ) {
    Intersection shadow_intersect = shadow_intersections[i];
    // intersection needs to be populated to determing if it should
    // cast shadows.
    // TODO: PERF: Think we just need a subset of this here, so
    // could save a few cycles
    compute_intersection_data(shadow_ray, shadow_intersect);

    // Objects behind the surface cannot cast a shadow on the surface
    if( shadow_intersect.t < 0.0 ) {
      continue;
    }

    // An object cannot cast shadows on itself
    // (Logically it can, but that's handled by the lighting
    // calculations, prior to this point)
    if( shadow_intersect.i == intersection.i ) {
      continue;
    }

    // The most definite shadow we can have - The outside
    // of an object (not self) is blocking the ray
    // As the ray is surface -> light here we need to check
    // on inside == true
    // Check on distance is to ensure object is between
    // the surface and the light
    if( shadow_intersect.inside == true &&
        shadow_intersect.t < l_distance ) {
          return true;
    }

    // If not there's 2 approaches here:
    // 1: Try to apply extra logic to work out if it's a shadow (tricky)
    // 2: Ensure rays start outside primitives to avoid acne (easy, reduces logic to the one case above)
    // TODO: Picked 2 in this case. Not perfect but easy and fast.
  }
#endif
  return false;
}

// Cast a ray along hit's reflection vector and find the next hit
// Return true if there's a reflected hit, false otherwise
// Populate reflected_hit with the new hit's parameters
bool compute_reflection(Intersection hit, out Intersection reflected_hit) {
#ifdef ENABLE_REFLECTIONS
  Ray r;

  r.origin = hit.pos + (limit_acne_factor * hit.normal);
  r.direction = hit.ray_reflect;

  Intersection reflect_intersections[limit_in_per_ray_max];
  ray_intersect_all(r, reflect_intersections);
  compute_intersection_data_all(r, reflect_intersections );

  int hit_index;
  return get_hit_sorted(reflect_intersections, reflected_hit, false, false, hit.i, hit_index);
#endif
  return false;
}

bool compute_transparency(Intersection intersections[limit_in_per_ray_max], int current_hit_i, 
                          out Intersection transparent_hit, out int transparent_hit_i) {
  // TODO: Will need rework when refraction is implemented
#ifdef ENABLE_TRANSPARENCY
  // Assuming we don't have refraction we just need to move along the intersections
  for( int i = current_hit_i + 1; i < limit_in_per_ray_max; i++ ) {
    transparent_hit = intersections[i];
    if( transparent_hit.t == limit_inf || transparent_hit.t < 0.0 ) {
      continue;
    }

    // This is the next intersection on the ray
    // Either it's leaving the transparent object we're inside,
    // Or hit a new object (which may or may not be transparent)
    transparent_hit_i = i;
    return true;
  }
#endif
  return false;
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// Shading functions
vec4 shade_phong( Intersection hit, bool enable_shadows ) {
  // Phong model, calculated in world space
  Material m = primitive_material(hit.i);

  vec4 shade = vec4(0.0);
  for( int il = 0; il < iNumLights; il++ ) {
    Light light = lights[il];

    // Incident vector, p -> light
    vec4 i = vector_light(hit.pos, light);
    // Subsequent vector, reflection of i
    vec4 s = vector_light_reflected(i, hit.normal);

    // Ambient component
#ifdef ENABLE_PATTERNS
    shade += (primitive_pattern(hit.i, m.ambient, hit.uv) * light.intensity);
#else
    shade += m.ambient * light.intensity;
#endif

    // Angle between light and surface normal
    float i_n = dot(i, hit.normal);
    if( i_n < 0.0 ) {
      // Light is behind the surface
      // diffuse & specular == 0
      // Shadow calculation disabled
    } else {
      // Light is somewhere in front of the surface
      // diffuse and specular based on light angle to surface
      // shadows may be casted by objects between surface and light
      //
      // Check if the light is blocked (in shadow)
      // If so diffuse and specular are zero
      if( enable_shadows && compute_shadow_cast( hit, light ) ) {
        continue;
      }
      
      // Diffuse component
#ifdef ENABLE_PATTERNS
      shade += (primitive_pattern(hit.i, m.diffuse, hit.uv) * light.intensity * i_n);
#else
      shade += m.diffuse * light.intensity * i_n;
#endif

      // Specular component
      float s_e = dot(s, hit.eye);
      if( s_e >= 0.0 )
      {
        float f = pow(s_e, m.specular.w);
        shade += (m.specular * light.intensity * f);
      }
    }
   }

  shade = shade / float(iNumLights);
  shade.a = 1.0;
  return shade;
}
/////////////////////////////////////////////////////////////////////////////////////////////////

Ray ray_for_pixel() {
  // Camera parameters
  float half_view_range = tan( viewParams.z / 2.0 );
  float aspect_ratio = viewParams.x / viewParams.y;
  
  float half_width = 0.0;
  float half_height = 0.0;
  if( aspect_ratio >= 1.0 ) {
    half_width = half_view_range;
    half_height = half_view_range / aspect_ratio;
  } else {
    half_width = half_view_range * aspect_ratio;
    half_height = half_view_range;
  }
  float frag_size = (half_width * 2.0) / viewParams.x;

  // Center of current pixel, relative to bottom left. 0,0 -> width,height
  vec2 frag_offset = ((vUV * viewParams.xy) + vec2(0.5)) * frag_size;

  vec4 frag_world = vec4(
    half_width - frag_offset.x,
    half_height - frag_offset.y,
    -1.0,
    1.0
  );
  // TODO: I was tired when I wrote this, based on p104 in The Ray Tracing Challenge
  frag_world.y *= -1.0;

  // Define the ray in world space
  Ray r;
  r.origin = inverse(viewMatrix) * vec4(0.0, 0.0, 0.0, 1.0);
  r.direction = normalize((inverse(viewMatrix) * frag_world) - r.origin);
  return r;
}

void main() {

  Ray r = ray_for_pixel();

  // All of the intersections on this ray
  IntersectArray arr = IntersectArray_init();
  ray_intersect_all( r, arr );
  IntersectArray_compute_data_all(arr, r);

  // Work out the hit
  // Choosing not to render inner surfaces here
  // This solves some render noise in tangent cases.
  Intersection hit;
  int hit_index = -1;
  if( !IntersectArray_first(arr, hit_index, hit) ) {
#ifdef DEBUG
    fragColor = vec4(1.0, 0.0, 1.0, 1.0);
#endif
    return;    
  }

#ifdef PERF_BENCH
/*
  // Intersection origIntersections[limit_in_per_ray_max] = intersections;
  for( int hack = 0; hack < 32; hack++ ) {
    ray_intersect_all( r, intersections );
  //   compute_intersection_data_all(r, intersections );

  //   // allow_self true as we don't have a 'self' yet (It's a hack, avoid the check in get_hit)
  //   hit_index = -1;
  //   if( !get_hit_sorted(intersections, hit, false, true, 0, hit_index) ) {
  // #ifdef DEBUG
  //     fragColor = vec4(1.0, 0.0, 1.0, 1.0);
  // #endif
  //     return;
  //   }
  }

  float t = - limit_float_max;
  for( int i = 0; i < limit_in_per_ray_max - 1; i++ ) {
    Intersection current = intersections[i];
    Intersection next = intersections[i + 1];
    if( next.t < current.t ) {
      fragColor = mix(vec4(1.0, 0.0, 0.0, 1.0), vec4(0.0, 0.0, 0.0, 1.0), sin(400.0 * distance(vUV, vec2(0.0, 0.0))));
      return;
    }
  }*/
#endif // PERF_BENCH

  // Shade the main hit
  vec4 shade = shade_phong( hit, true );

#ifdef ENABLE_REFLECTIONS
  // Reflect until we hit a non-reflective surface, or hit the reflection limit
  {
    Material current_m = primitive_material(hit.i);
    Intersection current_hit = hit;
    Intersection reflected_hit = hit;
    int reflection_depth = 0;
    while(current_m.phys.x != 0.0) {
      if( !compute_reflection(current_hit, reflected_hit) ) {
        // We failed to hit anything
        // - Ray heads off into the ether
        // - Or some other failure state, probably a few here
        break;
      }

      // Shade the reflection - But with shadows disabled, this is slow enough already
      // Mix based on the reflectivity of the current surface
      vec4 reflected_shade = shade_phong( reflected_hit, false );
      shade = mix(shade, reflected_shade, current_m.phys.x);

      current_hit = reflected_hit;
      current_m = primitive_material(current_hit.i);

      reflection_depth++;
      
      if( reflection_depth == limit_reflection_depth ) {
        // We can't go any further.
        // We could fade out here or do something fancy, the attempted options all look bad.
        // TODO: Fog would be a nice way to hide this. Maybe fog over the summed ray distance?
        // Either way we're done processing.
        break;
      }
    }
  }
#endif

#ifdef ENABLE_TRANSPARENCY
  // Handle transparency in a similar way to reflections - Continue along the ray
  // and shade based on each surface's transparency constant

  // TODO: For now refraction doesn't exist. WHen it's added this will need extensive rework
  {
    Material current_m = primitive_material(hit.i);
    Intersection current_hit = hit;
    Intersection transparent_hit = hit;
    int transparency_depth = 0;
    int current_hit_i = hit_index;
    int transparent_hit_i = hit_index;
    while(current_m.phys.y != 0.0) {
      if( !compute_transparency(intersections, current_hit_i, transparent_hit, transparent_hit_i) ) {
        // We failed to hit anything
        break;
      }

      // Shade the next hit on the ray, shadows disabled
      // Mix based on transparency of the current surface
      vec4 transparent_shade = shade_phong( transparent_hit, false );
      shade = mix(shade, transparent_shade, current_m.phys.y);

      current_hit = transparent_hit;
      current_hit_i = transparent_hit_i; // TODO: Naming - 'i' is confusing here
      current_m = primitive_material(current_hit.i);

      transparency_depth++;
      
      if( transparency_depth == limit_transparency_depth ) {
        // We can't go any further.
        break;
      }
    }
  }
#endif

  fragColor = shade;
}
