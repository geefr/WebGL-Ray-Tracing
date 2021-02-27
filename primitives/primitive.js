import * as glMatrix from '../modules/gl-matrix-2.8.1/lib/gl-matrix.js'

/*
// A primitive in the space
// meta.x - The type
// 1 - Sphere, at 0,0,0, radius = 1
// modelMatrix
struct Primitive {
  ivec4 meta;
  mat4 modelMatrix;
  vec4 reserved1;
  vec4 reserved2;
};
*/

class Primitive {
  constructor() {
    this.type = 0.0;
    this.modelMatrix = glMatrix.mat4.create();
    this.meta = glMatrix.vec4.create();
  }

  set_type = (t) => {
    this.meta[0] = t;
  }

  get_type = () => { return this.meta[0]; }
}

export default Primitive;