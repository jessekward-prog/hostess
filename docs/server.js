import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const app = express();
const PORT = 3046;

app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`hostess docs site: http://localhost:${PORT}`);
});
