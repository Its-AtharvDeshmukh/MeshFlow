const EventEmitter = require('events');
const logger = require('../utils/logger');

class InternalEventBus extends EventEmitter {
    emit(event, payload) {
        logger.info(`EVENT: ${event}`, { workflowId: payload?.workflowId, nodeId: payload?.nodeId });
        return super.emit(event, payload);
    }
}

const eventBus = new InternalEventBus();
module.exports = eventBus;