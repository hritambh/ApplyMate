import 'dotenv/config'; // This forces the .env file to load first
import { defineConfig } from '@prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Now we can safely use process.env directly
    url: process.env.DATABASE_URL,
  },
});