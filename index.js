require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

const stripe = require("stripe")(process.env.STRIPE_SECRET);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qzimykk.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("contest_hub");
    const userCollection = db.collection("users");
    const contestCollection = db.collection("contests");
    const submissionCollection = db.collection("submissions");
    const paymentCollection = db.collection("payments");
    // const contestCollection = db.collection("contests");

    // users apis

    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    // Add new user
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user"; // default
      user.createdAt = new Date();

      const exists = await userCollection.findOne({ email: user.email });
      if (exists) return res.send({ message: "User already exists" });

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    /** CONTESTS **/
    app.post("/contests", async (req, res) => {
      const contest = req.body;
      contest.status = "pending";
      contest.createdAt = new Date();
      const result = await contestCollection.insertOne(contest);
      res.send(result);
    });

    // Get all contests by creator email
    app.get("/contests/creator/:email", async (req, res) => {
      const email = req.params.email;
      const contests = await contestCollection
        .find({ creatorEmail: email })
        .toArray();
      res.send(contests);
    });

    // Get single contest
    app.get("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const contest = await contestCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(contest);
    });

    // Update contest (only pending allowed)
    app.patch("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const update = { $set: req.body };
      const result = await contestCollection.updateOne(
        { _id: new ObjectId(id), status: "pending" },
        update
      );
      res.send(result);
    });

    // Delete contest (only pending)
    app.delete("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const result = await contestCollection.deleteOne({
        _id: new ObjectId(id),
        status: "pending",
      });
      res.send(result);
    });

    app.get("/contests", async (req, res) => {
      const contests = await contestCollection
        .find({ status: "confirmed" })
        .toArray();
      res.send(contests);
    });

    app.get("/contests/popular", async (req, res) => {
      const contests = await contestCollection
        .find({ status: "confirmed" })
        .sort({ participants: -1 })
        .limit(5)
        .toArray();
      res.send(contests);
    });

    app.get("/contests/search", async (req, res) => {
      const type = req.query.type;
      const contests = await contestCollection
        .find({ status: "confirmed", type })
        .toArray();
      res.send(contests);
    });

    // Example Stripe endpoint
    app.post("/create-checkout-session", async (req, res) => {
      const { contestName, price, contestId, userEmail } = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: contestName },
                unit_amount: price * 100,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel`,

          metadata: { contestId, userEmail },
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Payment session failed" });
      }
    });

    app.post("/verify-payment", async (req, res) => {
      const { sessionId } = req.body;

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ message: "Payment not completed" });
        }

        const { contestId, userEmail } = session.metadata;

        // prevent duplicate
        const exists = await paymentCollection.findOne({
          contestId,
          userEmail,
        });
        if (exists) return res.send({ message: "Already registered" });

        await paymentCollection.insertOne({
          contestId,
          userEmail,
          amount: session.amount_total / 100,
          stripeSessionId: session.id,
          createdAt: new Date(),
        });

        await contestCollection.updateOne(
          { _id: new ObjectId(contestId) },
          { $inc: { participants: 1 } }
        );

        res.send({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Verification failed" });
      }
    });

    // Get participated contests for a user
    app.get("/participated-contests/:email", async (req, res) => {
      const email = req.params.email;

      const payments = await paymentCollection
        .find({ userEmail: email })
        .toArray();

      const contestIds = payments.map((p) => new ObjectId(p.contestId));

      const contests = await contestCollection
        .find({ _id: { $in: contestIds } })
        .toArray();

      res.send(contests);
    });

    // Add submission

    app.post("/submissions", async (req, res) => {
      const { userEmail, contestId, submissionLink } = req.body;
      await submissionCollection.insertOne({
        userEmail,
        contestId,
        submissionLink,
        createdAt: new Date(),
      });
      res.send({ message: "Task submitted" });
    });

    app.post("/submissions/:contestId", async (req, res) => {
      const contestId = req.params.contestId; // <--- এটি দরকার
      const submission = {
        ...req.body,
        contestId: new ObjectId(contestId), // MongoDB ObjectId হিসেবে store হবে
        isWinner: false,
        createdAt: new Date(),
      };

      const result = await submissionCollection.insertOne(submission);

      // increment participants count in contest
      await contestCollection.updateOne(
        { _id: new ObjectId(contestId) },
        { $inc: { participants: 1 } }
      );

      res.send(result);
    });

    // Get all submissions of a contest
    app.get("/submissions/contest/:contestId", async (req, res) => {
      const contestId = req.params.contestId;
      const subs = await submissionCollection
        .find({ contestId: new ObjectId(contestId) })
        .toArray();
      res.send(subs);
    });

    // Declare winner
    app.post("/contests/:contestId/declare-winner", async (req, res) => {
      const { submissionId } = req.body;
      const contestId = req.params.contestId;

      // mark submission as winner
      await submissionCollection.updateOne(
        { _id: new ObjectId(submissionId) },
        { $set: { isWinner: true } }
      );

      // mark contest winnerSubmissionId
      await contestCollection.updateOne(
        { _id: new ObjectId(contestId) },
        { $set: { winnerSubmissionId: submissionId } }
      );

      res.send({ ok: true });
    });

    // users apis start

    app.get("/payments/user/:email", async (req, res) => {
      const result = await paymentCollection
        .find({ email: req.params.email })
        .sort({ deadline: 1 })
        .toArray();
      res.send(result);
    });

    app.get("/wins/:email", async (req, res) => {
      const result = await contestCollection
        .find({
          winnerEmail: req.params.email,
        })
        .toArray();

      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("ContestHub is running");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
