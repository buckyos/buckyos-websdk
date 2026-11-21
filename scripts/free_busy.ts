import { freeBusy } from '../src/owner_availability'

const input = await new Response(Deno.stdin.readable).json()
console.log(JSON.stringify(freeBusy(input)))
