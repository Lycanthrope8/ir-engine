/*
CPAL-1.0 License

The contents of this file are subject to the Common Public Attribution License
Version 1.0. (the "License"); you may not use this file except in compliance
with the License. You may obtain a copy of the License at
https://github.com/ir-engine/ir-engine/blob/dev/LICENSE.
The License is based on the Mozilla Public License Version 1.1, but Sections 14
and 15 have been added to cover use of software over a computer network and
provide for limited attribution for the Original Developer. In addition,
Exhibit A has been modified to be consistent with Exhibit B.

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the
specific language governing rights and limitations under the License.

The Original Code is Infinite Reality Engine.

The Original Developer is the Initial Developer. The Initial Developer of the
Original Code is the Infinite Reality Engine team.

All portions of the code written by the Infinite Reality Engine team are Copyright © 2021-2023
Infinite Reality Engine. All Rights Reserved.
*/

import { RenderPass } from 'postprocessing'
import React, { useEffect } from 'react'
import { Color, CubeTexture, FogBase, Object3D, Scene, Texture } from 'three'

import {
  ComponentType,
  defineQuery,
  defineSystem,
  ECSState,
  Entity,
  getComponent,
  hasComponent,
  PresentationSystemGroup,
  QueryReactor,
  useComponent,
  useEntityContext
} from '@ir-engine/ecs'
import { getMutableState, getState, useMutableState } from '@ir-engine/hyperflux'

import { getNestedChildren } from '@ir-engine/ecs'
import { CameraComponent } from '../camera/components/CameraComponent'
import { XRState } from '../xr/XRState'
import { ObjectComponent } from './components/ObjectComponent'
import { ObjectLayerMaskComponent } from './components/ObjectLayerComponent'
import { RendererComponent } from './components/RendererComponent'
import { BackgroundComponent, EnvironmentMapComponent, FogComponent } from './components/SceneComponents'
import { VisibleComponent } from './components/VisibleComponent'
import { ObjectLayers } from './constants/ObjectLayers'
import { RenderModes } from './constants/RenderModes'
import { changeRenderMode } from './functions/changeRenderMode'
import { PerformanceManager, PerformanceState } from './PerformanceState'
import { RendererState } from './RendererState'

const rendererQuery = defineQuery([RendererComponent, CameraComponent])

export const filterVisible = (entity: Entity) => hasComponent(entity, VisibleComponent)
export const getNestedVisibleChildren = (entity: Entity) => getNestedChildren(entity, filterVisible)

export const render = (
  renderer: ComponentType<typeof RendererComponent>,
  scene: Scene,
  cameraComponent: ComponentType<typeof CameraComponent>,
  deltaSeconds: number
) => {
  // Extract the actual camera from the component
  const camera = cameraComponent as any
  if (!renderer.renderer) return

  const renderSettings = getState(RendererState)
  const usePostProcessing = renderSettings.usePostProcessing

  if (renderer.needsResize) {
    const canvas = renderer.canvas
    if (canvas) {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      renderer.renderer.setSize(width, height, false)
      if (renderer.effectComposer) {
        renderer.effectComposer.setSize(width, height)
      }
      renderer.needsResize = false
    }
  }

  if (renderer.csm) {
    renderer.csm.update()
    renderer.csm.updateFrustums()
  }

  if (usePostProcessing && renderer.effectComposer) {
    // We can't directly set scene and camera on renderPass due to protected properties
    // Instead, we create a new RenderPass with the updated scene and camera
    if (renderer.renderPass) {
      const newRenderPass = new RenderPass(scene, camera)
      // Replace the old renderPass in the composer
      renderer.effectComposer.removePass(renderer.renderPass)
      renderer.effectComposer.addPass(newRenderPass)
      renderer.renderPass = newRenderPass
    }
    renderer.effectComposer.render(deltaSeconds)
  } else if (renderer.renderer) {
    renderer.renderer.render(scene, camera)
  }
}

export const getSceneParameters = (entities: Entity[], cameraEntity: Entity) => {
  const vals = {
    background: null as Color | Texture | CubeTexture | null,
    environment: null as Texture | null,
    fog: null as FogBase | null,
    children: [] as Object3D[]
  }

  const cameraLayers = ObjectLayerMaskComponent.mask[cameraEntity]

  for (const entity of entities) {
    if (hasComponent(entity, EnvironmentMapComponent)) {
      vals.environment = getComponent(entity, EnvironmentMapComponent)
    }
    if (hasComponent(entity, BackgroundComponent)) {
      vals.background = getComponent(entity, BackgroundComponent as any) as Color | Texture | CubeTexture
    }
    if (hasComponent(entity, FogComponent)) {
      vals.fog = getComponent(entity, FogComponent)
    }
    // layer mask is faster with bitecs here than going through the object's proxy
    const shouldRender = (ObjectLayerMaskComponent.mask[entity] & cameraLayers) !== 0
    if (shouldRender && hasComponent(entity, ObjectComponent)) {
      vals.children.push(getComponent(entity, ObjectComponent))
    }
  }

  return vals
}

const execute = () => {
  const deltaSeconds = getState(ECSState).deltaSeconds

  const onRenderEnd = PerformanceManager.profileGPURender()
  for (const entity of rendererQuery()) {
    const camera = getComponent(entity, CameraComponent)
    const renderer = getComponent(entity, RendererComponent)
    const _scene = renderer.scene!

    const entitiesToRender = renderer.scenes.map(getNestedVisibleChildren).flat()
    const { background, environment, fog, children } = getSceneParameters(entitiesToRender, entity)
    _scene.children = children

    const renderMode = getState(RendererState).renderMode

    const sessionMode = getState(XRState).sessionMode
    _scene.background =
      sessionMode === 'immersive-ar' ? null : renderMode === RenderModes.WIREFRAME ? new Color(0xffffff) : background

    _scene.environment = environment

    _scene.fog = fog

    render(renderer, _scene, camera, deltaSeconds)
  }
  onRenderEnd()
}

const rendererReactor = () => {
  const entity = useEntityContext()
  const renderer = useComponent(entity, RendererComponent)
  const engineRendererSettings = useMutableState(RendererState)

  useEffect(() => {
    if (engineRendererSettings.automatic) return

    const qualityLevel = engineRendererSettings.qualityLevel
    getMutableState(PerformanceState).merge({
      gpuTier: qualityLevel,
      cpuTier: qualityLevel
    } as any)
  }, [engineRendererSettings.qualityLevel, engineRendererSettings.automatic])

  useEffect(() => {
    if (!renderer.renderer) return
    // Use the renderer directly instead of through the state
    const webglRenderer = renderer.renderer as any
    webglRenderer.setPixelRatio(window.devicePixelRatio * engineRendererSettings.renderScale.value)
    // We can't directly set needsResize, so we'll use a different approach
    // This is a workaround for the read-only property
    Object.defineProperty(renderer, 'needsResize', { value: true, writable: true })
  }, [engineRendererSettings.renderScale, !!renderer.renderer])

  useEffect(() => {
    changeRenderMode(entity)
  }, [engineRendererSettings.renderMode])

  return null
}

const cameraReactor = () => {
  const entity = useEntityContext()
  const camera = useComponent(entity, CameraComponent).value
  const engineRendererSettings = useMutableState(RendererState)

  useEffect(() => {
    if (engineRendererSettings.physicsDebug.value) camera.layers.enable(ObjectLayers.PhysicsHelper)
    else camera.layers.disable(ObjectLayers.PhysicsHelper)
  }, [engineRendererSettings.physicsDebug])

  useEffect(() => {
    if (engineRendererSettings.avatarDebug.value) camera.layers.enable(ObjectLayers.AvatarHelper)
    else camera.layers.disable(ObjectLayers.AvatarHelper)
  }, [engineRendererSettings.avatarDebug])

  useEffect(() => {
    if (engineRendererSettings.gridVisibility.value) camera.layers.enable(ObjectLayers.Gizmos)
    else camera.layers.disable(ObjectLayers.Gizmos)
  }, [engineRendererSettings.gridVisibility])

  useEffect(() => {
    if (engineRendererSettings.nodeHelperVisibility.value) camera.layers.enable(ObjectLayers.NodeHelper)
    else camera.layers.disable(ObjectLayers.NodeHelper)
  }, [engineRendererSettings.nodeHelperVisibility])

  return null
}

export const WebGLRendererSystem = defineSystem({
  uuid: 'ee.engine.WebGLRendererSystem',
  insert: { with: PresentationSystemGroup },
  execute,
  reactor: () => {
    return (
      <>
        <QueryReactor Components={[RendererComponent]} ChildEntityReactor={rendererReactor} />
        <QueryReactor Components={[CameraComponent]} ChildEntityReactor={cameraReactor} />
      </>
    )
  }
})
