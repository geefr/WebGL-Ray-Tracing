#version 300 es

layout (location=0) in vec3 position;
layout (location=1) in vec2 texCoord;

out vec3 fragPos;
out vec2 vUV;

void main() {
  fragPos = position;
  vUV = texCoord;
  gl_Position = vec4(position, 1.0);
}
