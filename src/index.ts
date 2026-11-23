import express, { type Express, type Request, type Response } from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
process.loadEnvFile();
const app: Express = express();
app.use(express.json());
app.use(cors());

const port = 4000;
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error('MONGODB_URI is missing from .env');
}

const mongoClient = new MongoClient(mongoUri);

app.get('/', (req: Request, res: Response) => {
  res.send('MongoDB server is running');
});


async function startServer(): Promise<void> {
  await mongoClient.connect();
  await mongoClient.db().admin().ping();
  const db = mongoClient.db('bankingUsers');
  const applicationsCollection = db.collection('bank-account');
  const allUsers = db.collection('user');
  const loanApplicationCollection = db.collection('loan-application');
  const adminLoanApplicationCollection = db.collection('loan-application-admin');
  console.log('MongoDB connected successfully');

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
  app.get('/api/users', async (req: Request, res: Response) => {
    const result = await allUsers.find().toArray();
    res.send(result);
  });
  app.get('/api/users/count', async (req: Request, res: Response) => {
    const totalCustomers = await allUsers.countDocuments();
    res.send({ totalCustomers });
  });
  app.get('/api/users/:id', async (req: Request, res: Response) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await allUsers.findOne(query);
      res.send(result);
  });
  app.get('/api/application', async (req: Request, res: Response) => {
    const result = await applicationsCollection
      .find()
      .project({
        transactionPinHash: 0,
        transactionPinSalt: 0,
        transactionPinFailedAttempts: 0,
        transactionPinLockedUntil: 0,
      })
      .toArray();
    res.send(result);
  });
  app.get('/api/application/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const accountWithNumber = await applicationsCollection.findOne(
      { userId: id, accountNumber: { $type: 'string', $ne: '' } },
      {
        sort: { _id: -1 },
        projection: {
          transactionPinHash: 0,
          transactionPinSalt: 0,
          transactionPinFailedAttempts: 0,
          transactionPinLockedUntil: 0,
        },
      },
    );
    const result = accountWithNumber ?? await applicationsCollection.findOne(
      { userId: id },
      {
        sort: { _id: -1 },
        projection: {
          transactionPinHash: 0,
          transactionPinSalt: 0,
          transactionPinFailedAttempts: 0,
          transactionPinLockedUntil: 0,
        },
      },
    );
    res.send(result);
  });
  app.get('/api/accounts/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    const result = await applicationsCollection
      .find({ userId })
      .project({
        _id: 0,
        accountNumber: 1,
        accountType: 1,
        initialDeposit: 1,
        balance: 1,
        status: 1,
        isActive: 1,
        transactionPinConfigured: 1,
      })
      .toArray();
    res.send(result);
  });
 app.get('/api/transactions', async (req: Request, res: Response) => {
  const { paymentType, statuses } = req.query;

  if (
    (paymentType !== undefined && typeof paymentType !== 'string') ||
    (statuses !== undefined && typeof statuses !== 'string')
  ) {
    res.status(400).send({ error: 'paymentType and statuses must be single strings' });
    return;
  }

  const query: { paymentType?: string; statuses?: string } = {};
  if (paymentType) query.paymentType = paymentType;
  if (statuses) query.statuses = statuses;

  const result = await db
    .collection('deposit')
    .find(query)
    .toArray();

  res.send(result);
});
app.get('/api/transactions/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const result = await db
    .collection('deposit')
    .find({ userId })
    .sort({ _id: -1 })
    .toArray();
  res.send(result);
});
app.patch('/api/transactions/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const statuses = req.body?.statuses;

  if (typeof statuses !== 'string' || statuses.trim() === '') {
    res.status(400).send({ error: 'statuses must be a non-empty string' });
    return;
  }

  const result = await db.collection('deposit').updateMany(
    { userId },
    { $set: { statuses: statuses.trim() } },
  );

  if (result.matchedCount === 0) {
    res.status(404).send({ error: 'No transactions found for this userId' });
    return;
  }

  res.send({
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  });
});
app.get('/api/loan-application-staff', async (req: Request, res: Response) => {
  const result = await loanApplicationCollection.find().toArray();
  res.send(result);
});
app.post('/api/loan-application-staff', async (req: Request, res: Response) => {
  const loanApplication = req.body;
  const result = await loanApplicationCollection.insertOne(loanApplication);
  res.send(result);
});
app.get('/api/loan-application-staff/:id', async (req: Request, res: Response) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await loanApplicationCollection.findOne(query);
      res.send(result);
  });
app.get('/api/loan-application-admin', async (req: Request, res: Response) => {
  const result = await adminLoanApplicationCollection.find().toArray();
  res.send(result);
});
app.post('/api/loan-application-admin', async (req: Request, res: Response) => {
  const loanApplication = req.body;
  const result = await adminLoanApplicationCollection.insertOne(loanApplication);
  res.send(result);
});
app.post('/api/transactions', async (req: Request, res: Response) => {
  const transaction = req.body;
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    res.status(400).send({ error: 'Request body must be a JSON object' });
    return;
  }

  const amount = Number(transaction.amount);
  if (
    typeof transaction.userId !== 'string' ||
    !transaction.userId.trim() ||
    typeof transaction.accountNumber !== 'string' ||
    !transaction.accountNumber.trim() ||
    !['deposit', 'withdrawal', 'transfer'].includes(
      String(transaction.paymentType).toLowerCase(),
    ) ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    res.status(400).send({ error: 'A valid account, transaction type, and positive amount are required' });
    return;
  }

  const result = await db.collection('deposit').insertOne({
    ...transaction,
    amount,
    statuses: 'pending',
    createdAt: new Date().toISOString(),
  });
  res.status(201).send(result);
});
 
  app.post('/api/application', (_req: Request, res: Response) => {
    res.status(405).send({
      error: 'Create bank accounts through the authenticated account form',
    });
  });
}

startServer().catch((error: unknown) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});