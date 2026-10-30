const { app, port } = require('./app');

app.listen(port, () => {
  console.log(`AI ExamHub API listening on port ${port}`);
});
