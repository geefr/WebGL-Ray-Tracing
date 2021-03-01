import * as glMatrix from '../modules/gl-matrix-2.8.1/lib/gl-matrix.js'

/*
// Basic Phong material
struct Material {
  vec4 ambient;    // rgba
  vec4 diffuse;    // rgba
  vec4 specular;   // rgbs, s=shininess
  vec4 phys;       // rti_, r=reflectivity, t=transparency, i=refractive index
};

hyperphysics.phy-astr.gdu.edu/Tables/indrf.html

*/

class Material {
  constructor() {
    this.ambient = [0.1, 0.1, 0.1, 1.0];
    this.diffuse = [0.9, 0.9, 0.9, 1.0];
    this.specular = [1.0, 1.0, 1.0, 32.0];
    this.phys = [0.0, 0.0, 1.0, 0.0];
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

  set_transparency = (f) => {
    this.phys[1] = f;
  }
  get_transparency = () => {
    return this.phys[1];
  }

  set_refractivi = (f) => {
    this.phys[2] = f;
  }
  get_transparency = () => {
    return this.phys[2];
  }
}

export default Material;