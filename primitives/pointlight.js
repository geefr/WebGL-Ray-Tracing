import * as glMatrix from '../modules/gl-matrix-2.8.1/lib/gl-matrix.js'

/*
// A point light
struct Light {
  vec4 intensity;  // rgb_
  vec4 position;   // xyz1 (TODO: Support for directional lights)
};
*/

class PointLight {
  constructor() {
    this.intensity = [1.0, 1.0, 1.0, 1.0];
    this.position = [0.0, 0.0, 0.0, 1.0];
  }
}

export default PointLight;