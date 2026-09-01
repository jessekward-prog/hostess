const path = require('path');
const express = require('express');

const app = express();
const PORT = 3046;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`hostess docs site: http://localhost:${PORT}`);
});
