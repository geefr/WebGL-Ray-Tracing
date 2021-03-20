import Primitive from './primitive.js'

// A Sphere. Origin = 0,0,0 Radius = 1
class Sphere extends Primitive {
  constructor() {
    super();
    this.type = 'sphere';
  }
}

export default Sphere;

