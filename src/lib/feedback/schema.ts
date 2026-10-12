import { z } from "zod";

/** A feature request. Shared by the form and the future POST /api/feedback, so both validate the same way. */
export const featureRequestSchema = z.object({
  message: z.string().trim().min(3, "Tell us a little more.").max(2000, "Please keep it under 2000 characters."),
  email: z.union([z.literal(""), z.email("That email doesn't look right.")]).optional(),
  /** where in the app it was sent from, e.g. "/calendar" */
  page: z.string().max(200),
});

export type FeatureRequest = z.infer<typeof featureRequestSchema>;

export const MESSAGE_MAX = 2000;
