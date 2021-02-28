#version 300 es

precision highp float;

in vec3 fragPos;
in vec2 vUV;

// Shadertoy uniforms
// TODO: Should add most of these in, but do it in a ubo if possible (may be close to the limit on some systems?)
uniform vec3 iResolution;           // viewport resolution (in pixels)
// uniform float     iTime;                 // shader playback time (in seconds)
// uniform float     iTimeDelta;            // render time (in seconds)
// uniform int       iFrame;                // shader playback frame
// uniform float     iChannelTime[4];       // channel playback time (in seconds)
// uniform vec4      iMouse;                // mouse pixel coords. xy: current (if MLB down), zw: click
// uniform vec4      iDate;                 // (year, month, day, time in seconds)
// uniform float     iSampleRate;           // sound sample rate (i.e., 44100)
// uniform vec3      iChannelResolution[4]; // Resolution of input channels
// uniform sampler2D iChannel0;             // Input channels (For audio in this case)

uniform mat4 viewProjectionMatrix;

// A primitive / object
// - modelMatrix
// - meta.x - The type
//   - 1 - Sphere, at 0,0,0, radius = 1
//   - If more types added update compute_intersection_data, mainImage, and any other places is_sphere is called
// - meta.y - Material index from ubo_0.materials
// 
// meta.zw - Unused for now
// Primitive intentionally only uses floats here, to simplify the buffer upload in js
// Try not to go over 16 KB of ubo - For (older?) intel chips
struct Primitive {
  mat4 modelMatrix;
  vec4 meta;
  vec4 pad1;
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
/////////////////////////////////////////////////////////////////////////////////////////////////
// Sphere functions
bool is_sphere(int i) { return primitives[i].meta.x == 1.0; }
vec3 sphere_origin(int i) { return (primitives[i].modelMatrix * vec4(vec3(0.0),1.0)).xyz; }
float sphere_radius(int i) { return (primitives[i].modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).x; }

// Intersection of ray with the sphere at primitives[i]
// - ray: A ray in world space (oh rayray, mommy misses you D:)
// - intersections array will be populated with t
// - Will return the number of intersections
// wiki/Line-sphere_intersection
int sphere_ray_intersect(int i, Ray ray, out Intersection[2] intersections) {
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

  intersections[0].i = i; intersections[1].i = i;
  if( abs(t1 - t2) < limit_epsilon ) { intersections[0].t = t1; intersections[1].t = t2; return 1; }
  else if( t1 < t2 ) { intersections[0].t = t1; intersections[1].t = t2; return 2; }
  else if( t2 < t1 ) { intersections[0].t = t2; intersections[1].t = t1; return 2; }
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
void sort_intersections( Intersection[limit_in_per_ray_max] intersections ) {
  Intersection result[limit_in_per_ray_max];
  for( int out_i = 0; out_i < limit_in_per_ray_max - 1; out_i++ ) {
    int smallest_i = closest_intersection(intersections, out_i, limit_in_per_ray_max);
    // Swap smallest with current element
    Intersection tmp = intersections[out_i];
    intersections[out_i] = intersections[smallest_i];
    intersections[smallest_i] = tmp;
  }
}

// Perform ray intersection with every primitive
void ray_intersect_all( Ray r, inout Intersection[limit_in_per_ray_max] intersections ) {
  int intersections_insert = 0;
  
  // Intersect with each primitive
  for( int i = 0; i < iNumPrimitives; i++ ) {
    if( is_sphere(i) ) {
      Intersection sphere_intersections[2];
      int ints = sphere_ray_intersect(i, r, sphere_intersections);

      for( int j = 0; j < ints; j++ ) {
        intersections[intersections_insert] = sphere_intersections[j];
        intersections_insert++;
      }
    }
  }
}

// Determine which intersection is the 'hit' - Smallest non-negative t
// Requires that intersections be sorted before calling
bool get_hit_sorted( Intersection[limit_in_per_ray_max] intersections, out Intersection hit ) {
  bool result = false;
  hit = intersections[0];
  if( hit.t == limit_inf ||
      hit.t <  0.0 ) {
        return false;
  } else {
    return true;
  }
}

// Compute whether a shadow is cast for a given intersection & light
// Note: previous attempt pre-calculated this for the intersection,
// but required assignment to element in array (intersection.shadow_casters[i])
// Turns out that's a problem causes https://stackoverflow.com/questions/60984733/warning-x3550-array-reference-cannot-be-used-as-an-l-value
//
// PERF: Shadows will be expensive
bool compute_shadow_cast( Intersection intersection, Light l ) {
  if( l.shadow.x == 0.0 ) {
    // This light doesn't cast shadows, skip
    return false;
  }

  // Okay, need to check for shadow, down the performance hole we go!
  // Distance from intersection to light - If a hit is closer than this along
  // our ray then an object is causing a shadow.
  float l_distance = distance(intersection.pos, l.position);

  // Start the ray just above the surface, to avoid acne (Self-shadows)
  // TODO: Alternate: Perform intersections, but ignore any hits on 
  // primitives[intersection.i].
  float fudge_factor = limit_epsilon * 10.0;

  Ray shadow_ray;
  shadow_ray.origin = intersection.pos + (intersection.normal * fudge_factor);
  shadow_ray.direction = vector_light(intersection.pos, l);

  Intersection shadow_intersections[limit_in_per_ray_max];
  init_intersections(shadow_intersections);
  ray_intersect_all(shadow_ray, shadow_intersections);

  for( int i = 0; i < limit_in_per_ray_max; i++ ) {
    Intersection shadow_intersect = shadow_intersections[i];
    if( shadow_intersect.i == intersection.i ) {
      continue;
    }

    if( shadow_intersect.t < l_distance ) {
      return true;
    }
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

/*
void compute_intersection_data_first( Ray r, inout Intersection[limit_in_per_ray_max] intersections ) { compute_intersection_data(r, intersections[0]); }
void compute_intersection_data_all( Ray r, inout Intersection[limit_in_per_ray_max] intersections ) { for( int i = 0; i < limit_in_per_ray_max; i++ ) {compute_intersection_data(r, intersections[i]);}}
*/

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
    shade += (m.ambient * light.intensity);

    // Check if the light is blocked (in shadow)
    // If so only the ambient component is used
    if( compute_shadow_cast( hit, light ) ) {
      continue;
    }

    // Angle between light and surface normal
    float i_n = dot(i, hit.normal);
    if( i_n < 0.0 ) {
      // Light is behind the surface, diffuse & specular == 0
    } else {
      // Diffuse component
      shade += (m.diffuse * light.intensity * i_n);

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

vec4 background_color() {
  return vec4(0.8, 0.8, 0.8, 1.0);
}

void main() {
  // fragPos -1.0 -> 1.0, clip space
  // vUV.st   0.0 -> 1.0

  // Our ray goes from the near plane, to the far plane
  // fragPos is in clip space, so we can defined it there
  // and then project back to world space
  // TODO: This relies heavily on the projection matrix, and can have depth precision
  // issues if values aren't chosen carefully. Would be better in the long run to replace this.
  vec4 source = inverse(viewProjectionMatrix) * vec4(- fragPos.x, fragPos.y, -1.0, 1.0);
  vec4 target = inverse(viewProjectionMatrix) * vec4(- fragPos.x, fragPos.y, 1.0, 1.0);

  Ray r;
  r.origin = source;
  r.direction = normalize(target - source);

  // All of the intersections on this ray
  Intersection intersections[limit_in_per_ray_max];
  init_intersections( intersections );

  ray_intersect_all( r, intersections );

  sort_intersections( intersections );

  // Work out the hit
  Intersection hit;
  init_intersection(hit);
  if( !get_hit_sorted(intersections, hit) ) {
    fragColor = background_color();
    return;
  }

  compute_intersection_data(r, hit);

  // And render
  fragColor = shade_phong( hit );

}
