export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const unsupported = (feature: string): never => {
  throw new AppError(501, `${feature}: capability unavailable on this connector`);
};
