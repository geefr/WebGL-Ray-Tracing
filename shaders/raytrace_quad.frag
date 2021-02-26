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
// meta.x - The type
// 1 - Sphere, at 0,0,0, radius = 1
// modelMatrix


blah blah blah blah

This bit should be done with a ubo - we'll have lots of em

struct Primitive {
  ivec4 meta;
  mat4 modelMatrix;
  vec4 reserved1;
  vec4 reserved2;
};

uniform int iNumPrimitives;
uniform Primitive[100] primitives;

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