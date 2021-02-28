import Primitive from './primitive.js'

// A Sphere. Origin = 0,0,0 Radius = 1
class Sphere extends Primitive {
  constructor() {
    super();
    this.set_type(1.0);
  }
}

export default Sphere;

