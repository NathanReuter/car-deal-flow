export class FipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FipeError";
  }
}
