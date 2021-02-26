import * as math from 'math';

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
    this.meta = [0, 0, 0, 0];
    this.modelMatrix = math.identity(4);
    this.reserved1 = [0.0, 0.0, 0.0, 0.0];
    this.reserved2 = [0.0, 0.0, 0.0, 0.0];
  }

  set_type = (t) => {
    this.meta[0] = t;
  }

}

export default Primitive;