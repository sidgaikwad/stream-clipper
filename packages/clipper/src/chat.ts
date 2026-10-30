export type ChatMessage = {
  at: number
  text: string
  user: string
}

const PRIVMSG = /^(?:@\S+ )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/

export const parseChatLine = (line: string, at: number): ChatMessage | null => {
  const match = PRIVMSG.exec(line)
  return match ? { at, text: match[2]!, user: match[1]! } : null
}

export const connectChat = (channel: string, onMessage: (message: ChatMessage) => void) => {
  let socket: WebSocket | undefined
  let stopped = false

  const open = () => {
    socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443")
    socket.addEventListener("open", () => {
      socket!.send("PASS SCHMOOPIIE")
      socket!.send(`NICK justinfan${Math.floor(10_000 + Math.random() * 80_000)}`)
      socket!.send(`JOIN #${channel.toLowerCase()}`)
    })
    socket.addEventListener("message", (event) => {
      const at = Date.now()
      for (const line of String(event.data).split("\r\n")) {
        if (line.startsWith("PING")) socket!.send(line.replace("PING", "PONG"))
        const message = parseChatLine(line, at)
        if (message) onMessage(message)
      }
    })
    socket.addEventListener("close", () => {
      if (!stopped) setTimeout(open, 5_000)
    })
  }

  open()
  return () => {
    stopped = true
    socket?.close()
  }
}
