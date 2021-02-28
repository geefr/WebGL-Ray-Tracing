#version 300 es

precision highp float;

// Enable error indicators
// - Diagonal red stripes: Intersections aren't sorted / depth ordering problem
// #define DEBUG

// Enable shadows
#define ENABLE_SHADOWS

// Enable patterns
// TODO: This really requires uv calculations for each primitive, and those aren't implemented yet
#define ENABLE_PATTERNS

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
  vec4 ambient;    // rgb_
  vec4 diffuse;    // rgb_
  vec4 specular;   // rgbs, s=shininess
  vec4 pad;
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
const int limit_in_per_ray_max = 10;
const float limit_inf = 1e20; // Could use 1.0 / 0.0, but nvidia optimises using uintBitsToFloat, which requires version 330
const float limit_float_max = 1e19;
const float limit_epsilon = 1e-12;

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
  vec2 uv;     // Intersection texture coord on primitive
};

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
void init_intersection( out Intersection intersection ) { 
  intersection.i = 0;
  intersection.t = limit_inf;
}
void init_intersections( out Intersection[limit_in_per_ray_max] intersections ) { for( int i = 0; i < limit_in_per_ray_max; i++ ) {init_intersection(intersections[i]);}}

int closest_intersection( inout Intersection[limit_in_per_ray_max] intersections, int min_i, int max_i ) {
  int smallest_i = max_i + 1;
  float smallest_t = limit_inf;
  for( int i = min_i; i < max_i; i++ ) {
    if( intersections[i].t <= smallest_t ) {
      smallest_t = intersections[i].t;
      smallest_i = i;
    }
  }
  return smallest_i;
}

// A simple sort, nothing fancy, probably not fast
// PERF: This is around 50% cost of trace + shadows + phong. Needs addressing
void sort_intersections( inout Intersection[limit_in_per_ray_max] intersections ) {
  Intersection result[limit_in_per_ray_max];
  for( int out_i = 0; out_i < limit_in_per_ray_max - 1; out_i++ ) {
    int closest_i = closest_intersection(intersections, out_i, limit_in_per_ray_max);

    // If the closest intersection is at infinity then there's no point continuing
    // everything remaining in the array is useless
    if( intersections[closest_i].t == limit_inf ) {
      for( ; out_i < limit_in_per_ray_max; out_i++ ) {
        init_intersection(intersections[out_i]);
      }
      return;
    }

    // Swap smallest with current element
    Intersection tmp = intersections[out_i];
    intersections[out_i] = intersections[closest_i];
    intersections[closest_i] = tmp;
  }
}

// Perform ray intersection with every primitive
void ray_intersect_all( Ray r, inout Intersection[limit_in_per_ray_max] intersections ) {
  int intersections_insert = 0;
  
  // Intersect with each primitive
  for( int i = 0; i < iNumPrimitives; i++ ) {
    if( is_sphere(i) ) {
      Intersection sphere_intersections[2];
      int ints = sphere_intersect(i, r, sphere_intersections);

      for( int j = 0; j < ints; j++ ) {
        intersections[intersections_insert] = sphere_intersections[j];
        intersections_insert++;
      }
    }
    else if( is_plane_xz(i) ) {
      Intersection plane_intersection;
      if( plane_xz_intersect(i, r, plane_intersection) ) {
        intersections[intersections_insert] = plane_intersection;
        intersections_insert++;
      }
    }
  }
}

// Determine which intersection is the 'hit' - Smallest non-negative t
// Requires that intersections be sorted before calling
// if allow_inside == true both inner and outer surfaces will be returned
bool get_hit_sorted( Intersection[limit_in_per_ray_max] intersections, out Intersection hit, bool allow_inside ) {
  bool result = false;

  for( int i = 0; i < limit_in_per_ray_max; i++ ) {
    hit = intersections[i];
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
    return true;
  }
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
  // Note: DO NOT compute shadows in here unless you want infinite recursion in your shader ;)
}

void compute_intersection_data_first( Ray r, inout Intersection[limit_in_per_ray_max] intersections ) { compute_intersection_data(r, intersections[0]); }
void compute_intersection_data_all( Ray r, inout Intersection[limit_in_per_ray_max] intersections ) { for( int i = 0; i < limit_in_per_ray_max; i++ ) {compute_intersection_data(r, intersections[i]);}}


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

  float acne_factor = limit_epsilon * 2.0;
  Ray shadow_ray;
  shadow_ray.origin = intersection.pos + (acne_factor * intersection.normal);
  shadow_ray.direction = vector_light(intersection.pos, l);

  Intersection shadow_intersections[limit_in_per_ray_max];
  init_intersections(shadow_intersections);
  ray_intersect_all(shadow_ray, shadow_intersections);

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


/////////////////////////////////////////////////////////////////////////////////////////////////
// Shading functions
vec4 shade_phong( Intersection hit ) {
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
      if( compute_shadow_cast( hit, light ) ) {
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
  Intersection intersections[limit_in_per_ray_max];
  init_intersections( intersections );

  ray_intersect_all( r, intersections );

  sort_intersections( intersections );

#ifdef DEBUG
  float t = - limit_float_max;
  for( int i = 0; i < limit_in_per_ray_max - 1; i++ ) {
    Intersection current = intersections[i];
    Intersection next = intersections[i + 1];
    if( next.t < current.t ) {
      fragColor = mix(vec4(1.0, 0.0, 0.0, 1.0), vec4(0.0, 0.0, 0.0, 1.0), sin(400.0 * distance(vUV, vec2(0.0, 0.0))));
      return;
    }
  }
#endif

  compute_intersection_data_all(r, intersections );

  // Work out the hit
  // Choosing not to render inner surfaces here
  // This solves some render noise in tangent cases.
  Intersection hit;
  init_intersection(hit);
  if( !get_hit_sorted(intersections, hit, false) ) {
    fragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }

  // And render
  fragColor = shade_phong( hit );
}
