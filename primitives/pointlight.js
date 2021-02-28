import * as glMatrix from '../modules/gl-matrix-2.8.1/lib/gl-matrix.js'

/*
// A point light
struct Light {
  vec4 intensity;  // rgb_
  vec4 position;   // xyz1 (TODO: Support for directional lights)
  vec4 shadow;     // Cast shadows if x != 0.0, yzw unused
};
*/

class PointLight {
  constructor() {
    this.intensity = [1.0, 1.0, 1.0, 1.0];
    this.position = [0.0, 0.0, 0.0, 1.0];
    // Shadows 
    this.cast_shadows = false;
  }
}

export default PointLight;