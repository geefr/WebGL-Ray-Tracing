#version 300 es

precision highp float;

in vec3 fragPos;
in vec2 vUV;

// Shadertoy uniforms
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
  vec4 pad1;
  vec4 pad2;
};

struct Material {
  vec4 ambient;    // rgb_
  vec4 diffuse;    // rgb_
  vec4 specular;   // rgbs, s=shininess
  vec4 pad1;
};

uniform int iNumPrimitives;
uniform int iNumMaterials;
uniform int iNumLights;
// This block only contains the primitives, to simplify the buffer upload in js
layout (std140) uniform ubo_0
{
  Light lights[10];
  Material materials[10];
  Primitive primitives[40];
} ;

out vec4 fragColor;

/////////////////////////////////////////////////////////////////////////////////////////////////
//// Limits and constants
// The maximum number of intersections for a single ray (Because glsl can't have dynamic arrays)
const int limit_in_per_ray_max = 10;
const float limit_inf = 1e20; // Could use 1.0 / 0.0, but nvidia optimises using uintBitsToFloat, which requires version 330
const float limit_float_max = 1e19;
const float limit_epsilon = 1e-6;

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
// Determine which intersection is the 'hit' - Smallest non-negative t
bool ray_hit( Intersection[limit_in_per_ray_max] intersections, out Intersection hit ) {
  hit.t = limit_float_max;
  bool result = false;
  for( int i = 0; i < limit_in_per_ray_max; i++ ) {
    Intersection intersection = intersections[i];
    if( intersection.t == limit_inf ) {
      // TODO: PERF: Maybe break on first inf? Requires intersections to be packed at beginning of array
      continue;
    }
    if( intersection.t < 0.0 ) {
      continue;
    }
    if( intersection.t < hit.t ) {
      hit = intersection;
      result = true;
    }
  }
  return result;
}
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
void init_intersection( out Intersection intersection ) { intersection.i = 0; intersection.t = limit_inf; }
void init_intersections( out Intersection[limit_in_per_ray_max] intersections ) { for( int i = 0; i < limit_in_per_ray_max; i++ ) {intersections[i].i = 0; intersections[i].t = limit_inf;}}
// Sort array of intersections by t, ascending
// TODO: This is broken
/*
Intersection[limit_in_per_ray_max] sort_intersections( Intersection[limit_in_per_ray_max] intersections ) {
  // A simple insertion sort, nothing fancy
  Intersection result[limit_in_per_ray_max];
  for( int out_i = limit_in_per_ray_max - 1; out_i >= 0; out_i-- ) {
    Intersection largest;
    init_intersection(largest);
    for( int in_i = limit_in_per_ray_max - 1; in_i >= 0; in_i-- ) {
      Intersection current = intersections[in_i];
      if( current.t == limit_inf ) {
        // It's the largest
        largest = current;
        break;
      } else if ( current.t > largest.t ) {
        largest = current;
      }
    }
    result[out_i] = largest;
  }
  return result;
}
*/
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
}

void compute_intersection_data_first( Ray r, inout Intersection[limit_in_per_ray_max] intersections ) { compute_intersection_data(r, intersections[0]); }
void compute_intersection_data_all( Ray r, inout Intersection[limit_in_per_ray_max] intersections ) { for( int i = 0; i < limit_in_per_ray_max; i++ ) {compute_intersection_data(r, intersections[i]);}}

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

//  intersections = sort_intersections( intersections );

  // Work out the hit
  Intersection hit;
  init_intersection(hit);
  if( !ray_hit(intersections, hit) ) {
    fragColor = background_color();
    return;
  }

  compute_intersection_data(r, hit);

  // And render
  fragColor = shade_phong( hit );

}
