#version 300 es

precision mediump float;

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

// A primitive in the space
// modelMatrix
// meta.x - The type
// 1 - Sphere, at 0,0,0, radius = 1
// meta.yzw - Unused for now
// Primitive intentionally only uses floats here, to simplify the buffer upload in js
// Try not to go over 16 KB of ubo - For (older?) intel chips
struct Primitive {
  mat4 modelMatrix;
  vec4 meta;
  vec4 unused1;
  vec4 unused2;
  vec4 unused3;
};

uniform int iNumPrimitives;
// This block only contains the primitives, to simplify the buffer upload in js
layout (std140) uniform ubo_primitives
{
  Primitive primitives[100];
};

out vec4 fragColor;

/////////////////////////////////////////////////////////////////////////////////////////////////
//// Limits and constants
// The maximum number of intersections for a single ray (Because glsl can't have dynamic arrays)
const int limit_in_per_ray_max = 10;
const float limit_inf = 1.0 / 0.0; // Ignore the warning here
const float limit_float_max = 1e20;
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
  float t;
  int i;
};

//// Utility functions
// Initialise a list of intersections to insane values
void init_intersection( out Intersection intersection ) { intersection.i = 0; intersection.t = limit_inf; }
void init_intersections( out Intersection[limit_in_per_ray_max] intersections ) { for( int i = 0; i < limit_in_per_ray_max; i++ ) {intersections[i].i = 0; intersections[i].t = limit_inf;}}
// TODO: May need sorting functions for intersections

//// Ray functions
// Determine which intersection is the 'hit' - Smallest non-negative t
bool ray_hit( Intersection[limit_in_per_ray_max] intersections, out Intersection hit ) {
  hit.t = limit_float_max;
  bool result = false;
  for( int i = 0; i < limit_in_per_ray_max; i++ ) {
    Intersection intersection = intersections[i];
    if( isinf(intersection.t) ) {
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
  if( abs(t1 - t2) < limit_epsilon ) { intersections[0].t = intersections[1].t = t1; return 1; }
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
// Shading functions
vec4 vector_eye( Ray ray, Intersection intersection ) { return normalize(ray_to_position(ray, intersection.t) - ray.origin); }

/////////////////////////////////////////////////////////////////////////////////////////////////

vec4 background_color(in vec2 fragCoord) {
  vec2 c = fragCoord.xy / iResolution.xy;
  return vec4(c.x, c.y, 1.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // -0.5 -> +0.5 x and y, not corrected for aspect
  vec2 c = (fragCoord.xy / iResolution.xy) - 0.5;

  // Quick and dirty perspective hack for ray testing :O
  // Let's assume the screen is a canvas, 0,0,z -> 2,2,z
  float cz = 10.0;
  c *= 2.0;
  c.x = ((c.x) * (iResolution.x / iResolution.y));

  // And the camera is at 0,0,0
  vec4 eye = vec4(0,0,0,1);

  Ray r;
  r.origin = eye;
  r.direction = normalize(vec4(c.xy, cz, 1.0) - eye);

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

  // Work out the hit
  Intersection hit;
  init_intersection(hit);
  if( !ray_hit(intersections, hit) ) {
    fragColor = background_color(fragCoord);
    return;
  }

  // And render
  vec4 p = ray_to_position( r, hit.t );
  vec4 n = sphere_normal( hit.i, p );

  float v = acos(dot(n, vec4(0.0, 1.0, 0.0, 0.0))) / 3.0;

  fragColor = vec4(v, 0.0, 0.0, 1.0);

  //float v = hit.t - 7.5;
  //fragColor = vec4(v,0.0,0.0, 1.0);
}

void main() {
  mainImage(fragColor, vUV.st * iResolution.xy);
}
