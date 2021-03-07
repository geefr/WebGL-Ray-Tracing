#version 300 es

precision highp float;

// Enable error indicators
// - Diagonal red stripes: Intersections aren't sorted / depth ordering problem
// #define DEBUG

// Enable features
#define ENABLE_SHADOWS
#define ENABLE_REFLECTIONS
#define ENABLE_TRANSPARENCY
// TODO: Patterns need some work - Would be extended to texture support or similar
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
// PERF: How many reflections/refractions to perform for the ray.
// Less than ~6 will be visually noticeable (Objects not being transparent when viewed through a mirror)
const int limit_reflection_and_transparency_depth = 8; 

// Could use 1.0 / 0.0, but nvidia optimises that using uintBitsToFloat, which requires version 330
const float limit_inf = 1e20;
// Smol value for float comparisons
const float limit_epsilon = 1e-12;

// Small offsets used to ensure intersections are the correct side of surfaces
// If too small noise/acne will be visible
const float limit_acne_factor = 1e-4;
const float limit_min_surface_thickness = 1e-3;

// PERF: If you've got a really nice gpu or want to melt your PC enable this
// While it doesn't look as good shadows should really be off after the first
// intersection, especially if multiple lights have shadows enabled.
const bool limit_subray_shadows_enabled = false;

/////////////////////////////////////////////////////////////////////////////////////////////////
//// Data Types
// A ray, starting at origin, travelling along direction
struct Ray {
  vec4 origin;
  vec4 direction;
};

// An intersection between a ray and primitives[i] at (t)
struct Intersection {
  float t;                // Intersection distance along the ray
  int i;                 // primitive index
  bool inside;          // true if intersection is within an object (Ray going from inside -> outside)
  vec4 pos;            // Intersection position
  vec4 eye;           // Intersection -> eye vector
  vec4 normal;       // Intersection normal
  vec4 ray_reflect; // Direction of reflected ray
  vec2 uv;         // Intersection texture coord on primitive
};

//// Ray functions
vec4 ray_to_position(Ray r, float t) { return r.origin + (r.direction * t); }
// Transform a ray from world space to model space (inverse of modelMatrix)
// Note that direction is left unnormalised - So that direction * t functions correctly
Ray ray_tf_world_to_model(Ray r, mat4 modelMatrix) {   
  mat4 m = inverse(modelMatrix);
  Ray rt;
  rt.origin = m * r.origin;
  rt.direction = m * r.direction;
  return rt;
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// Primitive Utility Functions
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
// Calculation of intersection vectors
vec4 vector_eye( vec4 p, vec4 eye ) { return normalize(eye - p); }
vec4 vector_light( vec4 p, Light l ) { return normalize(l.position - p); }
vec4 vector_light_reflected( vec4 i, vec4 n ) { return normalize(reflect(-i, n)); }

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

/////////////////////////////////////////////////////////////////////////////////////////////////
// Ray intersection functions
// TODO: For now there's multiple, could be largely unified into one function

// Perform ray intersecti
bool ray_hit_first( Ray r, inout Intersection intersection ) {
  intersection.t = limit_inf;
  bool result = false;
  // Intersect with each primitive
  for( int i = 0; i < iNumPrimitives; i++ ) {
    if( is_sphere(i) ) {
      Intersection sphere_intersections[2];
      int ints = sphere_intersect(i, r, sphere_intersections);
      for( int j = 0; j < ints; j++ ) {
        Intersection si = sphere_intersections[j];
        if( si.t < 0.0 ) continue;
        if( si.t < intersection.t ) {
          intersection = si;
          result = true;
        }
      }
    }
    else if( is_plane_xz(i) ) {
      Intersection plane_intersection;
      if( plane_xz_intersect(i, r, plane_intersection) ) {
        if( plane_intersection.t > 0.0 &&
            plane_intersection.t < intersection.t ) {
          intersection = plane_intersection;
          result = true;
        }
      }
    }
  }

  return result;
}

#ifdef ENABLE_REFLECTIONS
bool ray_hit_first_reflection( Ray r, inout Intersection intersection ) {
  intersection.t = limit_inf;
  bool result = false;
  // Intersect with each primitive
  for( int i = 0; i < iNumPrimitives; i++ ) {
    if( is_sphere(i) ) {
      Intersection sphere_intersections[2];
      int ints = sphere_intersect(i, r, sphere_intersections);
      for( int j = 0; j < ints; j++ ) {
        Intersection si = sphere_intersections[j];
        compute_intersection_data(r, si);
        if( si.t < 0.0 ) continue;
        if( si.inside ) continue;
        if( si.t < intersection.t ) {
          intersection = si;
          result = true;
        }
      }
    }
    else if( is_plane_xz(i) ) {
      Intersection plane_intersection;
      if( plane_xz_intersect(i, r, plane_intersection) ) {
        compute_intersection_data(r, plane_intersection);
        if( plane_intersection.inside ) continue;
        if( plane_intersection.t > 0.0 &&
            plane_intersection.t < intersection.t ) {
          intersection = plane_intersection;
          result = true;
        }
      }
    }
  }

  return result;
}
#endif

#ifdef ENABLE_TRANSPARENCY
bool ray_hit_first_transparency( Ray r, inout Intersection intersection, in Intersection current_intersection ) {
  intersection.t = limit_inf;
  bool result = false;
  bool require_side = !current_intersection.inside;
  // Intersect with each primitive
  for( int i = 0; i < iNumPrimitives; i++ ) {
    if( is_sphere(i) ) {
      Intersection sphere_intersections[2];
      int ints = sphere_intersect(i, r, sphere_intersections);
      for( int j = 0; j < ints; j++ ) {
        Intersection si = sphere_intersections[j];
        compute_intersection_data(r, si);
        if( si.t < 0.0 ) continue;

        // Make sure we're traversing across a surface
        // Distance check here avoids tunneling rays around the edges
        // of spheres
        if( si.i == current_intersection.i ) {
          if( si.inside != require_side ) continue;
          if( distance(si.pos, current_intersection.pos) < limit_min_surface_thickness ) continue;
        }

        if( si.t < intersection.t ) {
          intersection = si;
          result = true;
        }
      }
    }
    else if( is_plane_xz(i) ) {
      Intersection plane_intersection;
      if( plane_xz_intersect(i, r, plane_intersection) ) {
        compute_intersection_data(r, plane_intersection);

        // Probably less of an issue for planes
        if( plane_intersection.i == current_intersection.i ) {
          if( plane_intersection.inside != require_side ) continue;
          if( distance(plane_intersection.pos, current_intersection.pos) < limit_min_surface_thickness ) continue;
        }

        if( plane_intersection.t > 0.0 &&
            plane_intersection.t < intersection.t ) {
          intersection = plane_intersection;
          result = true;
        }
      }
    }
  }

  return result;
}
#endif

#ifdef ENABLE_SHADOWS
bool ray_hit_first_shadow( Ray r, inout Intersection intersection, in Intersection current_intersection, in float light_distance ) {
  /*
   Intersection check for shadow cast
   - return true if there's at least one hit between current_intersection and the light (t < light_distance)
   - And that hit is not the current object - Nothing can cast on itself (TODO: For now - With complex shapes that's not true)
  */
  for( int i = 0; i < iNumPrimitives; i++ ) {
    if( is_sphere(i) ) {
      Intersection sphere_intersections[2];
      int ints = sphere_intersect(i, r, sphere_intersections);
      for( int j = 0; j < ints; j++ ) {
        Intersection si = sphere_intersections[j];

        if( si.i == current_intersection.i ) continue;
        if( si.t < 0.0 ) continue;
        if( si.t > light_distance ) continue;

        intersection = si;
        return true;
      }
    }
    else if( is_plane_xz(i) ) {
      Intersection plane_intersection;
      if( plane_xz_intersect(i, r, plane_intersection) ) {
        if( plane_intersection.i == current_intersection.i ) continue;
        if( plane_intersection.t < 0.0 ) continue;
        if( plane_intersection.t > light_distance ) continue;

        intersection = plane_intersection;
        return true;
      }
    }
  }
  return false;
}
#endif

// Compute whether a shadow is cast for a given intersection & light
// PERF: Shadows are expensive
#ifdef ENABLE_SHADOWS
bool compute_shadow_cast( Intersection intersection, Light l ) {
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

  Intersection hit;
  return ray_hit_first_shadow( shadow_ray, hit, intersection, l_distance );
}
#endif

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
    // To better support transparency both outer
    // and inner surfaces have diffuse colour
    float i_n = dot(i, hit.normal);
    
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
    shade += (primitive_pattern(hit.i, m.diffuse, hit.uv) * light.intensity * abs(i_n));
#else
    shade += m.diffuse * light.intensity * abs(i_n);
#endif

    // Specular component
    // Not included for inner surfaces as that looks weird
    float s_e = (dot(s, hit.eye));
    if( s_e >= 0.0 )
    {
      float f = pow(s_e, m.specular.w);
      shade += (m.specular * light.intensity * f);
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

  // Perform the first ray intersection
  // and shade the first hit
  Intersection hit;
  if( !ray_hit_first( r, hit ) ) {
#ifdef DEBUG
    fragColor = vec4(1.0, 0.0, 1.0, 1.0);
#endif
    return;
  }
  compute_intersection_data( r, hit );
  vec4 shade = shade_phong( hit, true );

  // And if the surface we hit has special properties spawn additional rays from here
  // Here properties such as reflectivity and transparency are mutually exclusive.
  // This is to keep the performance sensible, and avoid hacks to perform
  // recursion in glsl.
  Material current_m = primitive_material(hit.i);
  Intersection current_hit = hit;
  Ray current_ray = r;

  // The contribution for the current surface. Compound of each reflectivity factor as we go
  float shade_factor = 1.0;
  // Limit on depth - Hopefully by the time this is hit shade_factor will be tiny
  int depth = 0;
  while(depth != limit_reflection_and_transparency_depth) {
    // If the surface isn't reflective or translucent
    // then stop. Nowhere else to go from here.
    if( current_m.phys.x == 0.0 &&
        current_m.phys.y == 0.0 ) {
      break;
    }

    // Reflection
    if( current_m.phys.x != 0.0 ) {
      current_ray.origin = current_hit.pos + (limit_acne_factor * current_hit.normal);
      current_ray.direction = current_hit.ray_reflect;
      if( !ray_hit_first_reflection(current_ray, current_hit) ) {
        // We failed to hit anything
        // - Ray heads off into the ether
        // - Or some other failure state, probably a few here
        break;
      }
      compute_intersection_data(current_ray, current_hit);

      // Shade the reflection - But with shadows disabled, this is slow enough already
      // Mix based on the reflectivity of the current surface
      shade_factor *= current_m.phys.x;
      vec4 reflected_shade = shade_phong( current_hit, limit_subray_shadows_enabled );
      shade = mix(shade, reflected_shade, shade_factor);
    }
    
    // Transparency / Refraction
    else if( current_m.phys.y != 0.0 ) {
      // Continue the ray from just the other side of the surface
      current_ray.origin = current_hit.pos + (limit_acne_factor * (- hit.normal));
      current_ray.direction = current_ray.direction; // TODO: Refraction
      if( !ray_hit_first_transparency(current_ray, current_hit, current_hit) ) {
        // We failed to hit anything
        break;
      }
      compute_intersection_data(current_ray, current_hit);

      // Shade the next hit on the ray, shadows disabled
      // Mix based on transparency of the current surface
      shade_factor *= current_m.phys.y;
      vec4 transparent_shade = shade_phong( current_hit, limit_subray_shadows_enabled );
      shade = mix(shade, transparent_shade, shade_factor);
    }
    current_m = primitive_material(current_hit.i);
    depth++;
  }

  fragColor = shade;
}
