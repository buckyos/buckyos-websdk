import { scheduleAction } from './schedule.mjs'

export default (request, host) => scheduleAction('calendar', request, host)
