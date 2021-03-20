import * as glMatrix from '../modules/gl-matrix-2.8.1/lib/gl-matrix.js'

/*
// A primitive in the space
// meta.x - The type
// 1 - Sphere, at 0,0,0, radius = 1
// meta.y - Material index
// meta.z - Pattern type
// - 0.0: none
// - 1.0: stripe/dots
struct Primitive {
  ivec4 meta;
  mat4 modelMatrix;
  vec4 pattern;
  vec4 reserved2;
};
*/

class Primitive {
  constructor() {
    this.modelMatrix = glMatrix.mat4.create();
    this.meta = glMatrix.vec4.create();
    this.pattern = glMatrix.vec4.create();
    this.type = '';
  }

  // Type of the primitive - should be defined by sub-classes
  set_type_number = (t) => { this.meta[0] = t; }
  get_type_number = () => { return this.meta[0]; }

  // The material index in Renderer.materials array
  set_material = (i) => { this.meta[1] = i; }
  get_material = () => { return this.meta[1]; }

  // The pattern type to apply to primitive
  set_pattern_type = (i) => { this.meta[2] = i; }
  get_pattern_type = () => { return this.meta[2]; }
}

export default Primitive;