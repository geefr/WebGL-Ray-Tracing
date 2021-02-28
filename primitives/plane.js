import Primitive from './primitive.js'

// An infinite plane, X-Z
class PlaneXZ extends Primitive {
  constructor() {
    super();
    this.set_type(2.0);
  }
}

export default PlaneXZ;

