define [], () ->

	class LabelsManager

		constructor: (@ide, @$scope, @labels) ->

			@ide.socket.on 'broadcastDocMeta', (data) =>
				@labels.onBroadcastDocLabels data
			@$scope.$on 'entity:deleted', @labels.onEntityDeleted
			@$scope.$on 'file:upload:complete', @labels.fileUploadComplete

		loadProjectLabelsFromServer: () ->
			@labels.loadProjectLabelsFromServer()
