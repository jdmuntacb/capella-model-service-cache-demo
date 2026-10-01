import { createMockGateway } from "./server";

const port = Number(process.env.MOCK_PORT ?? 8787);
const model = process.env.CMS_MODEL ?? "anthropic.claude-sonnet-5-5";
const { server } = createMockGateway({
  scoreThreshold: Number(process.env.MOCK_SCORE_THRESHOLD ?? 0.75),
  models: [model],
});
server.listen(port, () => {
  console.log(`Mock Capella Model Service on http://localhost:${port} (model ${model})`);
});
