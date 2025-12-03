import express from 'express';

const app = express();

app.use(express.json())

app.post('/webhooks/cf-membership-cancelled', (req, res) => {
  console.log(req.body)
  res.sendStatus(200)
})

app.listen(3000, () => console.log("Server running on port 3000"));
