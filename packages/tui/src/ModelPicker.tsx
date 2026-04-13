import React, { useState } from 'react'
import { Picker } from './Picker.js'
import type { PickerItem } from './Picker.js'

interface ProviderInfo {
  id: string
  name: string
  models: string[]
}

interface ModelPickerProps {
  providers: ProviderInfo[]
  currentProvider: string
  currentModel: string
  onSelect: (provider: string, model: string) => void
  onCancel: () => void
}

type Step = 'provider' | 'model'

export function ModelPicker({
  providers,
  currentProvider,
  currentModel,
  onSelect,
  onCancel,
}: ModelPickerProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('provider')
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(null)

  const providerItems: PickerItem<string>[] = providers.map(p => ({
    label: p.id,
    value: p.id,
    description: p.name,
  }))

  function handleProviderSelect(item: PickerItem<string>): void {
    const provider = providers.find(p => p.id === item.value)
    if (provider) {
      setSelectedProvider(provider)
      setStep('model')
    }
  }

  function handleModelSelect(item: PickerItem<string>): void {
    const providerId = selectedProvider?.id ?? currentProvider
    onSelect(providerId, item.value)
  }

  function handleModelCancel(): void {
    setStep('provider')
    setSelectedProvider(null)
  }

  if (step === 'model' && selectedProvider !== null) {
    const modelItems: PickerItem<string>[] = selectedProvider.models.map(m => ({
      label: m,
      value: m,
    }))

    const currentModelValue =
      selectedProvider.id === currentProvider ? currentModel : undefined

    return (
      <Picker
        items={modelItems}
        title={`Select Model — ${selectedProvider.name}`}
        onSelect={handleModelSelect}
        onCancel={handleModelCancel}
        selectedValue={currentModelValue}
      />
    )
  }

  return (
    <Picker
      items={providerItems}
      title="Select Provider"
      onSelect={handleProviderSelect}
      onCancel={onCancel}
      selectedValue={currentProvider}
    />
  )
}
