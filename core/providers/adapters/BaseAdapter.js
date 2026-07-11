class BaseAdapter {
    async execute(prompt, model) { throw new Error("Adapter 'execute' not implemented"); }
}
module.exports = BaseAdapter;