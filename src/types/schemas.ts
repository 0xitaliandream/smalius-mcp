import { z } from 'zod';

export const StartInputSchema = z.object({
  emulatorPort: z
    .number()
    .int()
    .min(5554)
    .max(5682)
    .optional()
    .describe('Emulator console port (auto-selected if not provided)'),
  bootTimeout: z
    .number()
    .int()
    .min(30000)
    .max(600000)
    .default(120000)
    .describe('Emulator boot timeout in milliseconds'),
  headless: z
    .boolean()
    .default(false)
    .describe('Run emulator in headless mode (-no-window)'),
});

export type StartInput = z.infer<typeof StartInputSchema>;
