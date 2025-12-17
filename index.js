require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

const stripe = require("stripe")(process.env.STRIPE_SECRET);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");

// middleware
app.use(express.json());
app.use(cors());

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // token missing
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodedUser = await admin.auth().verifyIdToken(token);
    req.decoded = decodedUser; // email, uid available
    next();
  } catch (error) {
    return res.status(401).send({ message: "Invalid token" });
  }
};

module.exports = verifyToken;

// Firebase initialize
const serviceAccount = require("./firebase-services-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
    // aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    // Admin stats route
    app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();

        const totalCreators = await userCollection.countDocuments({
          role: "creator",
        });

        const totalContests = await contestCollection.countDocuments();

        const payments = await paymentCollection.find().toArray();

        const totalEarnings = payments.reduce(
          (sum, payment) => sum + (payment.amount || 0),
          0
        );

        res.send({
          totalUsers,
          totalCreators,
          totalContests,
          totalEarnings,
        });
      } catch (error) {
        console.error("Admin stats error:", error);
        res.status(500).send({ message: "Failed to load admin stats" });
      }
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.patch("/users/role/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { role } = req.body;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role } }
      );
      res.send(result);
    });

    app.get("/contests/admin", verifyToken, verifyAdmin, async (req, res) => {
      const contests = await contestCollection.find().toArray();
      res.send(contests);
    });

    app.patch(
      "/contests/confirm/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await contestCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status: "confirmed" } }
        );
        res.send(result);
      }
    );

    app.patch(
      "/contests/reject/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await contestCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status: "rejected" } }
        );
        res.send(result);
      }
    );

    // aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

    // ✅ Get user role by email
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;

      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      res.send({ role: user.role || "user" });
    });
    app.patch("/users/:email", async (req, res) => {
      const email = req.params.email;
      const { role } = req.body; // expected: "user", "creator", "admin"

      if (!role) return res.status(400).send({ message: "Role is required" });

      try {
        const result = await userCollection.updateOne(
          { email },
          { $set: { role } }
        );

        if (result.matchedCount === 0)
          return res.status(404).send({ message: "User not found" });

        res.send({ success: true, message: `Role updated to ${role}` });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to update role" });
      }
    });

    // users apis

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

    app.put("/users/:email", async (req, res) => {
      const email = req.params.email;
      const updateData = req.body;

      try {
        const result = await userCollection.updateOne(
          { email },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ success: true, message: "User profile updated" });
      } catch (err) {
        console.error("Profile update error:", err);
        res.status(500).send({ error: "Failed to update profile" });
      }
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });

      const participatedContests = await paymentCollection.countDocuments({
        userEmail: email,
      });
      const winningContests = await contestCollection.countDocuments({
        winnerEmail: email,
      });

      res.send({ ...user, participatedContests, winningContests });
    });

    /** CONTESTS **/
    app.post("/contests", async (req, res) => {
      const contest = req.body;

      contest.status = "pending";
      contest.participants = 0; // ✅ MUST
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
      const { status } = req.body; // expected: "confirmed" or "rejected"

      if (!status)
        return res.status(400).send({ message: "Status is required" });

      try {
        const result = await contestCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          { $set: { status } }
        );

        if (result.matchedCount === 0)
          return res
            .status(404)
            .send({ message: "Contest not found or already updated" });

        res.send({ success: true, message: `Contest ${status}` });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to update contest status" });
      }
    });

    app.patch("/contests/edit/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      delete updateData._id; // safety

      try {
        const result = await contestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Contest not found" });
        }

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to update contest" });
      }
    });
    app.delete(
      "/contests/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await contestCollection.deleteOne({
            _id: new ObjectId(id),
          });

          if (result.deletedCount === 0) {
            return res.status(404).send({ message: "Contest not found" });
          }

          res.send({
            success: true,
            message: "Contest deleted successfully by admin",
          });
        } catch (err) {
          console.error("Admin delete error:", err);
          res.status(500).send({ error: "Failed to delete contest" });
        }
      }
    );

    // Delete contest (only pending)
    app.delete("/contests/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await contestCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0)
          return res.status(404).send({ message: "Contest not found" });

        res.send({ success: true, message: "Contest deleted successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to delete contest" });
      }
    });

    app.get("/contests", async (req, res) => {
      const contests = await contestCollection
        .find({ status: "confirmed" })
        .toArray();
      res.send(contests);
    });

    app.get("/contests/popular", async (req, res) => {
      try {
        if (!contestCollection) {
          console.error("Contest collection is not initialized!");
          return res.status(500).send({ error: "Database not connected" });
        }

        // Fetch all confirmed contests
        const contests = await contestCollection
          .find({ status: "confirmed" })
          .toArray();

        if (!contests || contests.length === 0) {
          return res.send([]); // No contests found
        }

        // Safely map contests
        const safeContests = contests.map((contest) => ({
          _id: contest._id,
          name: contest.name ?? "Untitled Contest",
          description: contest.description ?? "",
          image: contest.image ?? "/default-contest.png",
          participants: contest.participants ?? 0,
          prizeMoney: contest.prizeMoney ?? 0,
          deadline: contest.deadline ?? null,
          type: contest.type ?? "general",
        }));

        // Sort by participants descending
        safeContests.sort((a, b) => b.participants - a.participants);

        // Return top 5 popular contests
        res.send(safeContests.slice(0, 5));
      } catch (err) {
        console.error("Popular contests fetch error:", err);
        res.status(500).send({ error: "Failed to fetch popular contests" });
      }
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


    app.get("/participated-contests/:email", async (req, res) => {
      const email = req.params.email;

      try {
        // Step 1: Get all payments by this user
        const payments = await paymentCollection
          .find({ userEmail: email })
          .toArray();

        if (!payments || payments.length === 0) {
          return res.send([]); // no participated contests
        }

        // Step 2: Remove duplicate contestIds
        const contestIds = [
          ...new Set(payments.map((p) => p.contestId)),
        ].map((id) => new ObjectId(id));

        // Step 3: Fetch contests from contestCollection
        const contests = await contestCollection
          .find({ _id: { $in: contestIds } })
          .toArray();

        res.send(contests);
      } catch (err) {
        console.error("Error fetching participated contests:", err);
        res
          .status(500)
          .send({ error: "Failed to fetch participated contests" });
      }
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
      const { userEmail, submissionLink } = req.body;
      const contestId = req.params.contestId;

      const exists = await submissionCollection.findOne({
        contestId: new ObjectId(contestId),
        userEmail,
      });

      if (exists) {
        return res.status(400).send({ message: "Already submitted" });
      }

      const result = await submissionCollection.insertOne({
        userEmail,
        submissionLink,
        contestId: new ObjectId(contestId),
        isWinner: false,
        createdAt: new Date(),
      });

      res.send(result);
    });

    // Get all submissions of a contest
    app.get("/submissions/contest/:contestId", async (req, res) => {
      const submissions = await submissionCollection
        .find({ contestId: new ObjectId(req.params.contestId) })
        .toArray();
      res.send(submissions);
    });

    // Declare winner (only by contest creator or admin)
    app.post("/contests/:contestId/declare-winner", async (req, res) => {
      const { submissionId } = req.body;
      const contestId = req.params.contestId;

      const submission = await submissionCollection.findOne({
        _id: new ObjectId(submissionId),
      });
      if (!submission)
        return res.status(404).send({ message: "Submission not found" });

      await submissionCollection.updateOne(
        { _id: new ObjectId(submissionId) },
        { $set: { isWinner: true } }
      );

      await contestCollection.updateOne(
        { _id: new ObjectId(contestId) },
        {
          $set: {
            winnerSubmissionId: submissionId,
            winnerEmail: submission.userEmail,
            status: "ended",
          },
        }
      );

      res.send({ success: true, message: "Winner declared successfully!" });
    });

    // Get winning contests for a user
    app.get("/wins/:email", async (req, res) => {
      const result = await contestCollection
        .find({ winnerEmail: req.params.email })
        .toArray();
      res.send(result);
    });

    // users apis start
    app.get("/payments/user/:email", async (req, res) => {
      const result = await paymentCollection
        .find({ userEmail: req.params.email }) // ✅ ঠিক
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
