export class Resource {
  constructor(attributes) {
    this.attributes = attributes;
  }
  
  static default() {
    return new Resource({});
  }
  
  static EMPTY = new Resource({});
  
  merge(other) {
    return new Resource({
      ...this.attributes,
      ...other.attributes
    });
  }
}