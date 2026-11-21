import { scheduleAction } from './schedule.mjs'

export default (request, host) => scheduleAction('todo', request, host)
