/*
CPAL-1.0 License

The contents of this file are subject to the Common Public Attribution License
Version 1.0. (the "License"); you may not use this file except in compliance
with the License. You may obtain a copy of the License at
https://github.com/EtherealEngine/etherealengine/blob/dev/LICENSE.
The License is based on the Mozilla Public License Version 1.1, but Sections 14
and 15 have been added to cover use of software over a computer network and 
provide for limited attribution for the Original Developer. In addition, 
Exhibit A has been modified to be consistent with Exhibit B.

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the
specific language governing rights and limitations under the License.

The Original Code is Ethereal Engine.

The Original Developer is the Initial Developer. The Initial Developer of the
Original Code is the Ethereal Engine team.

All portions of the code written by the Ethereal Engine team are Copyright © 2021-2023 
Ethereal Engine. All Rights Reserved.
*/

import { UserID } from '@etherealengine/common/src/schema.type.module'
import { Engine } from '@etherealengine/engine/src/ecs/classes/Engine'
import { defineSystem } from '@etherealengine/engine/src/ecs/functions/SystemFunctions'
import { getNearbyUsers } from '@etherealengine/engine/src/networking/functions/getNearbyUsers'
import { defineState, getMutableState, getState } from '@etherealengine/hyperflux'

import { EngineState } from '@etherealengine/engine/src/ecs/classes/EngineState'
import { PresentationSystemGroup } from '@etherealengine/engine/src/ecs/functions/SystemGroups'
import { NetworkState } from '@etherealengine/engine/src/networking/NetworkState'
import { useEffect } from 'react'
import { MediaInstanceState, useMediaNetwork } from '../common/services/MediaInstanceConnectionService'
import { SocketWebRTCClientNetwork } from './SocketWebRTCClientFunctions'

export const FilteredUsersState = defineState({
  name: 'FilteredUsersState',
  initial: () => ({
    nearbyLayerUsers: [] as UserID[]
  })
})

export const FilteredUsersService = {
  updateNearbyLayerUsers: () => {
    if (!NetworkState.worldNetwork) return
    const mediaState = getMutableState(FilteredUsersState)
    const peers = Object.values(NetworkState.worldNetwork.peers)
    const worldUserIds = peers
      .filter((peer) => peer.peerID !== NetworkState.worldNetwork.hostPeerID && peer.userId !== Engine.instance.userID)
      .map((peer) => peer.userId)
    const nearbyUsers = getNearbyUsers(Engine.instance.userID, worldUserIds)
    mediaState.nearbyLayerUsers.set(nearbyUsers)
  }
}

export const updateNearbyAvatars = () => {
  const network = NetworkState.mediaNetwork as SocketWebRTCClientNetwork
  if (!network) return

  FilteredUsersService.updateNearbyLayerUsers()

  const channelConnectionState = getState(MediaInstanceState)
  const currentChannelInstanceConnection = channelConnectionState.instances[network.id]
  if (!currentChannelInstanceConnection) return

  const filteredUsersState = getState(FilteredUsersState)
  const nearbyUserIds = filteredUsersState.nearbyLayerUsers

  if (!nearbyUserIds.length) return

  // for (const consumer of network.consumers) {
  //   if (consumer.appData.peerID === Engine.instance.peerID) continue
  //   if (!nearbyUserIds.includes(network.peers.get(consumer.appData.peerID)?.userId!)) {
  //     dispatchAction(
  //       MediaConsumerActions.consumerClosed({
  //         consumerID: consumer.id,
  //         $topic: network.topic
  //       })
  //     )
  //   }
  // }
}

// every 5 seconds
const NEARBY_AVATAR_UPDATE_PERIOD = 5
let accumulator = 0

const execute = () => {
  accumulator += getState(EngineState).deltaSeconds
  if (accumulator > NEARBY_AVATAR_UPDATE_PERIOD) {
    accumulator = 0
    updateNearbyAvatars()
  }
}

const reactor = () => {
  const mediaNetwork = useMediaNetwork()

  useEffect(() => {
    accumulator = NEARBY_AVATAR_UPDATE_PERIOD
  }, [mediaNetwork?.peers])

  return null
}

export const FilteredUsersSystem = defineSystem({
  uuid: 'ee.client.FilteredUsersSystem',
  insert: { after: PresentationSystemGroup },
  execute,
  reactor
})
