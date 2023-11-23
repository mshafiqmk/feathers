import { strict as assert } from 'assert'
import { io, Socket } from 'socket.io-client'
import { verify } from '@feathersjs/tests-vitest'
import { RealTimeConnection } from '@feathersjs/feathers'

export default (name: string, options: any) => {
  const call = (method: string, ...args: any[]) => {
    return new Promise((resolve, reject) => {
      const { socket } = options
      const emitArgs = [method, name].concat(args)

      socket.emit(...emitArgs, (error: any, result: any) => (error ? reject(error) : resolve(result)))
    })
  }

  const verifyEvent = (callback: (data: any) => void, resolve: () => void, reject: (err: any) => void) => {
    return function (data: any) {
      try {
        callback(data)
        resolve()
      } catch (error: any) {
        reject?.(error)
      }
    }
  }

  describe('Basic service events', () => {
    let socket: Socket
    let connection: RealTimeConnection

    beforeAll(
      () =>
        new Promise<void>((resolve) => {
          options.app.once('connection', (conn: RealTimeConnection) => {
            connection = conn

            options.app.channel('default').join(connection)
            options.app.publish(() => options.app.channel('default'))
            resolve()
          })
          socket = io('http://localhost:7886')
        })
    )

    afterAll(
      () =>
        new Promise<void>((resolve) => {
          socket.once('disconnect', () => resolve())
          socket.disconnect()
        })
    )

    it(`${name} created`, () =>
      new Promise<void>((resolve, reject) => {
        const original = {
          name: 'created event'
        }

        socket.once(
          `${name} created`,
          verifyEvent((data) => verify.create(original, data), resolve, reject)
        )

        call('create', original)
      }))

    it(`${name} updated`, () =>
      new Promise<void>((resolve, reject) => {
        const original = {
          name: 'updated event'
        }

        socket.once(
          `${name} updated`,
          verifyEvent((data: any) => verify.update(10, original, data), resolve, reject)
        )

        call('update', 10, original)
      }))

    it(`${name} patched`, () =>
      new Promise<void>((resolve, reject) => {
        const original = {
          name: 'patched event'
        }

        socket.once(
          `${name} patched`,
          verifyEvent((data: any) => verify.patch(12, original, data), resolve, reject)
        )

        call('patch', 12, original)
      }))

    it(`${name} removed`, () =>
      new Promise<void>((resolve, reject) => {
        socket.once(
          `${name} removed`,
          verifyEvent((data: any) => verify.remove(333, data), resolve, reject)
        )

        call('remove', 333)
      }))

    it(`${name} custom events`, () =>
      new Promise<void>((resolve, reject) => {
        const service = options.app.service(name)
        const original = {
          name: 'created event'
        }

        socket.once(
          `${name} log`,
          verifyEvent(
            (data: any) => {
              assert.deepStrictEqual(data, {
                message: 'Custom log event',
                data: original
              })
            },
            resolve,
            reject
          )
        )

        service.emit('log', {
          data: original,
          message: 'Custom log event'
        })
      }))
  })

  describe('Event channels', () => {
    const eventName = `${name} created`

    let connections: RealTimeConnection[]
    let sockets: any[]

    beforeAll(
      () =>
        new Promise<void>((resolve) => {
          let counter = 0
          const handler = (connection: RealTimeConnection) => {
            counter++

            options.app.channel(connection.channel).join(connection)

            connections.push(connection)

            if (counter === 3) {
              resolve()
              options.app.removeListener('connection', handler)
            }
          }

          connections = []
          sockets = []

          options.app.on('connection', handler)

          sockets.push(
            io('http://localhost:7886', {
              query: { channel: 'first' }
            }),

            io('http://localhost:7886', {
              query: { channel: 'second' }
            }),

            io('http://localhost:7886', {
              query: { channel: 'second' }
            })
          )
        })
    )

    afterAll(() => {
      sockets.forEach((socket) => socket.disconnect())
    })

    it(`filters '${eventName}' event for a single channel`, () =>
      new Promise<void>((resolve, reject) => {
        const service = options.app.service(name)
        const [socket, otherSocket] = sockets
        const onError = () => {
          reject(new Error('Should not get this event'))
        }

        service.publish('created', (data: any) => options.app.channel(data.room))

        socket.once(eventName, (data: any) => {
          assert.strictEqual(data.room, 'first')
          otherSocket.removeEventListener(eventName, onError)
          resolve()
        })

        otherSocket.once(eventName, onError)

        service.create({
          text: 'Event dispatching test',
          room: 'first'
        })
      }))

    it(`filters '${name} created' event for a channel with multiple connections`, () =>
      new Promise<void>((resolve, reject) => {
        let counter = 0

        const service = options.app.service(name)
        const [otherSocket, socketOne, socketTwo] = sockets
        const onError = () => {
          resolve(new Error('Should not get this event'))
        }
        const onEvent = (data: any) => {
          counter++
          assert.strictEqual(data.room, 'second')

          if (++counter === 2) {
            otherSocket.removeEventListener(eventName, onError)
            reject()
          }
        }

        service.publish('created', (data: any) => options.app.channel(data.room))

        socketOne.once(eventName, onEvent)
        socketTwo.once(eventName, onEvent)
        otherSocket.once(eventName, onError)

        service.create({
          text: 'Event dispatching test',
          room: 'second'
        })
      }))
  })
}
