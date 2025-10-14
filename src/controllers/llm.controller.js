const runDemoChat = (req, res) => {
  return res.status(501).json({ error: "Integración con LLM no implementada aún" });
};

module.exports = { runDemoChat };
