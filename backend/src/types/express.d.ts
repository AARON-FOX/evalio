export {};

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        role: "creator" | "respondent" | "admin";
      };
    }
  }
}
