import Primitive from './primitive.js'

// An infinite plane, X-Z
class PlaneXZ extends Primitive {
  constructor() {
    super();
    this.type = 'plane_xz';
  }
}

export default PlaneXZ;

