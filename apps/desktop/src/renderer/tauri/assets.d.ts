/** Vite resolves an imported image to its URL. */
declare module "*.png" {
  const url: string;
  export default url;
}
