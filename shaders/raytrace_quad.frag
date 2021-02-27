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

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // 0.0 -> 1.0 x and y, not corrected for aspect
  vec2 c = fragCoord.xy / iResolution.xy;

  if( distance(vec2(0.5, 0.5), c.xy) < 0.2)
  {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
  else
  {
    fragColor = vec4(c.x, c.y, 1.0, 1.0);
  }
}

void main() {
  mainImage(fragColor, vUV.st * iResolution.xy);
}
