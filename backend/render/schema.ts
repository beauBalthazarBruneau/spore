import { z } from "zod"

export const ResumeJsonSchema = z.object({
  name: z.string(),
  contact: z.object({
    email: z.string(),
    phone: z.string().optional(),
    location: z.string().optional(),
    links: z.record(z.string()).optional(),
  }),
  summary: z.string().optional(),
  experience: z.array(z.object({
    company: z.string(),
    title: z.string(),
    dates: z.string(),
    location: z.string().optional(),
    bullets: z.array(z.string()),
  })),
  education: z.array(z.object({
    institution: z.string(),
    degree: z.string(),
    dates: z.string(),
  })),
  skills: z.record(z.array(z.string())).optional(),
})

export type ResumeJson = z.infer<typeof ResumeJsonSchema>
