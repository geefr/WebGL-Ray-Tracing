import * as glMatrix from '../modules/gl-matrix-2.8.1/lib/gl-matrix.js'

/*
// Basic Phong material
struct Material {
  vec4 ambient;    // rgb_
  vec4 diffuse;    // rgb_
  vec4 specular;   // rgbs, s=shininess
};
*/

class Material {
  constructor() {
    this.name = "";
    this.ambient = [0.1, 0.1, 0.1, 1.0];
    this.diffuse = [0.8, 0.8, 0.8, 1.0];
    this.specular = [0.9, 0.9, 0.9, 32.0];
  }
}

export default Material;