declare module 'multer';

declare global {
  namespace Express {
    interface Request {
      file?: any;
    }
  }
}

export {};
