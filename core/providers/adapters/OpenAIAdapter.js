const BaseAdapter = require('./BaseAdapter');
const { executeAI } = require('../mesh');

class OpenAIAdapter extends BaseAdapter {
    async execute(prompt, model) {
        // Abstraction layer allows payload formatting specifically for OpenAI in the future
        return await executeAI(prompt, model, "OpenAI");
    }
}
module.exports = OpenAIAdapter;