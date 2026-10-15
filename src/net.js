// Peer-to-peer room networking (serverless WebRTC via BitTorrent trackers).
// Room code => shared private room. Positions, profiles, chat, map votes + voice streams.

export async function createNet(roomCode, handlers) {
  const { joinRoom, selfId } = await import('@trystero-p2p/torrent')
  const room = joinRoom({ appId: 'rooms-fps-game-v1' }, `rooms-${roomCode}`)

  const posAction = room.makeAction('pos', {
    onMessage: (data, { peerId }) => handlers.onPos(peerId, data)
  })
  const profileAction = room.makeAction('profile', {
    onMessage: (data, { peerId }) => handlers.onProfile(peerId, data)
  })
  const chatAction = room.makeAction('chat', {
    onMessage: (data, { peerId }) => handlers.onChat(peerId, data)
  })
  const mapAction = room.makeAction('map', {
    onMessage: (data, { peerId }) => handlers.onMap(peerId, data)
  })

  room.onPeerJoin = (peerId) => {
    handlers.onJoin(peerId)
    // announce ourselves so the newcomer learns our profile + the room's map
    try { profileAction.send(handlers.selfProfile()) } catch {}
  }
  room.onPeerLeave = (peerId) => handlers.onLeave(peerId)
  room.onPeerStream = (stream, peerId) => handlers.onStream(stream, peerId)

  // keep profiles fresh (late joiners)
  const profileTimer = setInterval(() => {
    try { profileAction.send(handlers.selfProfile()) } catch {}
  }, 8000)

  const safeSend = (action, d) => { try { action.send(d).catch(() => {}) } catch {} }

  return {
    room,
    selfId,
    peers: () => { try { return room.getPeers() } catch { return {} } },
    sendPos: (d) => safeSend(posAction, d),
    sendProfile: (d) => safeSend(profileAction, d),
    sendChat: (d) => safeSend(chatAction, d),
    sendMap: (d) => safeSend(mapAction, d),
    addStream: (s) => { try { room.addStream(s)?.forEach?.(p => p.catch?.(() => {})) } catch (e) { console.warn('addStream', e) } },
    leave: () => { clearInterval(profileTimer); try { room.leave() } catch {} }
  }
}
