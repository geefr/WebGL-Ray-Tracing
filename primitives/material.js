import * as glMatrix from '../modules/gl-matrix-2.8.1/lib/gl-matrix.js'

/*
// Basic Phong material
struct Material {
  vec4 ambient;    // rgba
  vec4 diffuse;    // rgba
  vec4 specular;   // rgbs, s=shininess
  vec4 phys;       // rti_, r=reflectivity, t=transparency, i=refractive index
};
*/

class Material {
  constructor() {
    this.ambient = [0.1, 0.1, 0.1, 1.0];
    this.diffuse = [0.9, 0.9, 0.9, 1.0];
    this.specular = [1.0, 1.0, 1.0, 32.0];
    this.phys = [0.0, 0.0, 0.0, 0.0];
  }

  set_shininess = (f) => {
    this.specular[3] = f;
  }
  get_shininess = () => {
    return this.specular[3];
  }

  set_reflectivity = (f) => {
    this.phys[0] = f;
  }
  get_reflectivity = () => {
    return this.phys[0];
  }
}

export default Material;