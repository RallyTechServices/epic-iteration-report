Ext.define("TSEpicIterationReport", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    
    layout:'border',

    integrationHeaders : {
        name : "TSEpicIterationReport"
    },

    pickableColumns: null,
    epicFields: [],
    fields_to_skip: ["ObjectID","ObjectUUID","VersionId","DragAndDropRank","FormattedID","Name"],
    
    stateful: true,
    stateEvents: ['columnschosen','columnmoved','columnresize'],
    stateId: 'CA.technicalservices.iterationreport.settings',
    
    getState: function() {
        var me = this,
            state = null;

        var columns = Ext.Array.map( this.pickableColumns, function(col){
            var column = Ext.clone(col);
            column.renderer = null;
            return column;
        });
        
        state = {
            pickableColumns: columns
        };

        return state;
    },
    
    config: {
        defaultSettings: {
        }
    },  

    launch: function() {
        this._getEpicFields().then({
            success: function(fields) {
                this.epicFields = fields;
                this._addComponents();
            },
            failure: function(msg) {
                Ext.Msg.alert('',msg);
            },
            scope: this
        });
    },
    
    _addComponents: function(container) {
        this.removeAll();
        
        this.headerContainer = this.add({
            xtype:'container',
            itemId:'header-ct',
            region:'north',
            layout: { type:'hbox' }
        });
        
        this.displayContainer = this.add({
            xtype:'container',
            region:'center',
            layout: 'fit',
            itemId:'body-ct'
        });
        
        if ( this.getSetting('showScopeSelector') || this.getSetting('showScopeSelector') == "true" ) {
            this.headerContainer.add({
                xtype:'tsmultiprojectpicker',
                listeners: {
                    change: function(picker,projects) {
                        this._changeProjects(picker,projects);
                        this._publishProjects();
                    },
                    scope: this
                }
            });
            this.subscribe(this, 'requestProjects', this._publishProjects, this);
        } else {
            this.subscribe(this,'projectsChanged',this._changeProjects,this);
            this.publish('requestProjects',this);
        }
        this._addSelectors(this.headerContainer);
    },
    
    _addSelectors:function(container){
        var me = this;
        console.log('setting picks showColumnPicker>>', me.getSetting('showColumnPicker'));
        container.add({
            xtype:'tscolumnpickerbutton',
            pickableColumns: this.pickableColumns,
            listeners: {
                scope: this,
                columnschosen: function(button,columns) {
                    this.pickableColumns = columns;
                    this.fireEvent('columnschosen');
                    this._updateData();
                }
            }
        });
        
        container.add({
            xtype:'rallymultiobjectpicker',
            modelType:'Iteration',
            fieldLabel: 'Iteration:',
            labelWidth: 55,
            width: 400,
            storeConfig: {
                context: {
                    projectScopeUp: false,
                    projectScopeDown: false
                },
                fetch:['Name','ObjectID','StartDate','EndDate'],
                sorters: [{property:'EndDate',direction:'DESC'}]

            },
            listeners: { 
                scope: this,
                blur: this._updateData
            }
        });
        
        container.add({ xtype:'container', flex: 1});
        
        container.add({
            xtype:'rallybutton',
            itemId:'export_button',
            cls: 'secondary',
            text: '<span class="icon-export"> </span>',
            disabled: true,
            listeners: {
                scope: this,
                click: function() {
                    this._export();
                }
            }
        });
        
    },
    
    _changeProjects: function(picker,projects) {
        this.projects = projects;
        this.displayContainer.removeAll();
        this._updateData();
    },
    
    _publishProjects: function() {
        this.publish('projectsChanged',this.down('tsmultiprojectpicker'), this.projects || []);
    },
    
    _updateData: function() {
        var cb = this.down('rallymultiobjectpicker');
        var iterations = [];
        
        if ( cb ) {
            cb.collapse();
            iterations = cb.getValue();
        }
        
        this.down('#export_button').setDisabled(true);

        if ( iterations.length === 0 ) { return; }
        
        Deft.Chain.pipeline([
            function() { return this._getStoriesInIterations(iterations); },
            this._arrangeRecordsByProjectAndEpic,
            this._makeRows
        ],this).then({
            scope: this,
            success: function(rows) {
                this.display_rows = rows;
                this._makeGrid(rows);
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem Loading Data', msg);
            }
        });
    },
    
    _makeGrid: function(rows) {
        var container = this.displayContainer;
        
        container.removeAll();
        
        var store = Ext.create('Rally.data.custom.Store',{
            data: rows,
            groupField: 'Iteration'
        });
        
        container.add({
            xtype:'rallygrid',
            store: store,
            columnCfgs: this._getColumns(),
            showRowActionsColumn: false,
            features: [{
                ftype: 'groupingsummary',
                groupHeaderTpl: '{groupValue}'
            }]
        });
        
        this.down('#export_button').setDisabled(false);
    },
    
    _getColumns: function() {
        var columns = Ext.Array.merge([], this._getBaseLeftColumns());
        
        columns = Ext.Array.merge(columns, this._getPickableColumns());
        
        columns = Ext.Array.merge(columns, this._getBaseRightColumns());

        return columns;
    },
    



    _makeRows: function(records_by_iteration_by_project) {
        this.logger.log('records_by_iteration_by_project',records_by_iteration_by_project);

        var rows = [];
        //Get total of PlanEstimates for all projects so that we can find the % for each row. 
        Ext.Object.each(records_by_iteration_by_project, function(iteration_name,hash){
            var epic_plan_est_total = 0;
            Ext.Object.each(hash, function(project_oid, project_set){
                Ext.Object.each(project_set.records, function(epic_oid, epic_set){
                    var plan_estimates = Ext.Array.map(epic_set.records, function(record){
                        var size = record.get('PlanEstimate') || 0;
                        return 1000 * size;
                    });
                    epic_plan_est_total += Ext.Array.sum(plan_estimates);
                });
            });
        
            Ext.Object.each(hash, function(project_oid, project_set){
                var project = project_set.project;
                Ext.Object.each(project_set.records, function(epic_oid, epic_set){
                    var epic = epic_set.epic;

                    var plan_estimates = Ext.Array.map(epic_set.records, function(record){
                        var size = record.get('PlanEstimate') || 0;
                        return 1000 * size;
                    });
                 
                    var epic_percentage = 100 * Ext.Array.sum(plan_estimates) / epic_plan_est_total;
                    
                    var row = {
                        Project: project,
                        ProjectName: project.Name,
                        Epic: epic,
                        EpicName: epic.Name,
                        EpicOID: epic_oid,
                        EpicState: epic.State && epic.State._refObjectName,
                        Records: epic_set.records,
                        PlanEstimate: Ext.Array.sum(plan_estimates) / 1000,
                        EpicPercentage: epic_percentage,
                        c_ExtID01TPR: epic.c_ExtID01TPR,
                        Iteration: iteration_name
                    };
                    
                    rows.push(row);
                });
            });
        });
        return rows;
    },
    
    _arrangeRecordsByProjectAndEpic: function(records) {
        this.logger.log('_arrangeRecordsByProjectAndEpic',records);
        
        var records_by_iteration = {};
        
        Ext.Array.each(records, function(record){
            records_by_iteration = Ext.Object.merge(records_by_iteration, record);
        });
        
        this.logger.log('records_by_iteration',records_by_iteration);
        
        var records_by_iteration_by_project = {};

        Ext.Object.each(records_by_iteration, function(iteration_name, iteration_records){
            var records_by_project = {};

            Ext.Array.each(iteration_records, function(record){
                var project = record.get('Project');
                var epic = { FormattedID:"", Name:"None", ObjectID:-1 };
                var feature = record.get('Feature');
                
                if ( !Ext.isEmpty(feature) && !Ext.isEmpty(feature.Parent) ) {
                    epic = feature.Parent;
                }
                
                var project_oid = project.ObjectID;
                var epic_oid = epic.ObjectID;
                
                if ( Ext.isEmpty(records_by_project[project_oid]) ) {
                    records_by_project[project_oid] = {
                        project: project,
                        records: {}
                    };
                }
                
                if ( Ext.isEmpty( records_by_project[project_oid]['records'][epic_oid] )) {
                    records_by_project[project_oid]['records'][epic_oid] = {
                        epic: epic,
                        records:[]
                    };
                }
                records_by_project[project_oid]['records'][epic_oid].records.push(record);
            });
            records_by_iteration_by_project[iteration_name] = records_by_project;
        });
        

        return records_by_iteration_by_project;
    },
    
    _getStoriesInIterations: function(iterations) {
        var me = this;
        var project_oids = [];
        if ( !Ext.isEmpty(this.projects) && this.projects.length > 0 ) {
            project_oids = Ext.Array.map(this.projects, function(project){
                return project.ObjectID;
            });
        }
        
        var promises = Ext.Array.map(iterations, function(iteration){
            return function() { return me._getStoriesInIteration(iteration,project_oids); }
        });
        
        return Deft.Chain.sequence(promises, this);
    },
    
    _getFetchFields: function() {
        var fields = ['FormattedID','Name','PlanEstimate','Project',
            'Feature','Parent','ObjectID','c_ExtID01TPR',
            'LeafStoryPlanEstimateTotal','State','Iteration'];
        Ext.Array.each(this._getPickableColumns(), function(column) {
            if ( !column.hidden ) {
                fields.push(column.fieldName);
            }
        });
        
        return fields;
    },
    
    _getStoriesInIteration: function(iteration,project_oids) {
        this.logger.log('_getStoriesInIteration', iteration);
        var deferred = Ext.create('Deft.Deferred');
        
        var iteration_filters = Rally.data.wsapi.Filter.and(
            [{property:'Iteration.Name',value:iteration.get('Name')}]
        );
        
        var project_filters = Rally.data.wsapi.Filter.or(
            Ext.Array.map(project_oids,function(oid){
                return {property:'Project.ObjectID',value:oid};
            })
        );
        
        var config = {
            model:'HierarchicalRequirement',
            fetch: this._getFetchFields(),
            limit: Infinity
        };
        
        if ( Ext.isEmpty(project_oids) || project_oids.length === 0 ) {
            config.filters = iteration_filters;
        } else {
            config.context = { project: null };
            config.filters = iteration_filters.and(project_filters);
        }
        
        this._loadWsapiRecords(config).then({
            success: function(stories) {
                var response = {};
                response[iteration.get('Name')] = stories;
                deferred.resolve(response);
            },
            failure: function(msg) {
                deferred.reject(msg);
            },
            scope: this
        });
        return deferred.promise;
    },
      
    _loadWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID'],
            compact: false
        };

        me.setLoading('Loading ' + config.model + '...');
        
        this.logger.log("Starting load:",config.model);
        Ext.create('Rally.data.wsapi.Store', Ext.Object.merge(default_config,config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
                
                me.setLoading(false);
            }
        });
        return deferred.promise;
    },
    
    _export: function(){
        var me = this;
        this.logger.log('_export');
        
        var grid = this.down('rallygrid');
        var rows = this.display_rows;
        
        
        this.logger.log('number of rows:', rows.length);
        
        if ( !grid && !rows ) { return; }
        
        var filename = 'epic-iteration-report.csv';

        this.logger.log('saving file:', filename);
        
        this.setLoading("Generating CSV");
        Deft.Chain.sequence([
            function() { return Rally.technicalservices.FileUtilities.getCSVFromRows(this,grid,rows); } 
        ]).then({
            scope: this,
            success: function(csv){
                this.logger.log('got back csv ', csv.length);
                if (csv && csv.length > 0){
                    Rally.technicalservices.FileUtilities.saveCSVToFile(csv,filename);
                } else {
                    Rally.ui.notify.Notifier.showWarning({message: 'No data to export'});
                }
                
            }
        }).always(function() { me.setLoading(false); });
    },
    
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    getSettingsFields: function() {
        var me = this;
        var check_box_margins = '0 0 10 10';
        
        // var type_filters = Rally.data.wsapi.Filter.or([
        //     {property: 'TypePath', value: 'HierarchicalRequirement'},
        //     {property: 'TypePath', operator: 'contains', value: 'PortfolioItem/'}
        // ]);

        return [
        
        {
            name: 'showScopeSelector',
            xtype: 'rallycheckboxfield',
            boxLabelAlign: 'after',
            fieldLabel: '',
            margin: check_box_margins,
            boxLabel: 'Show Project Selector'
        },
        {
            name: 'showEpicPercentage',
            xtype: 'rallycheckboxfield',
            boxLabelAlign: 'after',
            fieldLabel: '',
            margin: check_box_margins,
            boxLabel: 'Show percentage of story points for epic are in the sprint'
        },{
                xtype: 'rallyfieldpicker',
                name: 'columnNames',
                itemId: 'columnNames',
                fieldLabel: 'Choose Fields',
                width: 250,
                margin: '0 0 300 10',    
                autoExpand: true,
                alwaysExpanded: true,
                modelTypes: ['PortfolioItem'],
                fieldBlackList: me.fields_to_skip
        }

        // ,
        // {
        //     name: 'showColumnPicker',
        //     itemId: 'showColumnPicker',
        //     xtype:'tscolumnpickerbutton',
        //     pickableColumns: me._getPickableColumns(),
        //     margin: '0 0 300 10',
        //     listeners: {
        //         scope: me,
        //         columnschosen: function(button,columns) {
        //             console.log('pickableColumns',columns);
        //             me.colsFromSettings = columns;
        //             me.fireEvent('columnschosen');
        //         }
        //     }
        // }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    },
    
    _setPickableColumns: function(pickable_columns) {
        var columns = Ext.Array.merge([], this._getBaseLeftColumns());
        columns = Ext.Array.merge(columns, pickable_columns);
        columns = Ext.Array.merge(columns, this._getBaseRightColumns());
    },
    
    _getBaseLeftColumns:function() {
        var columns = [];
        
        columns.push({ dataIndex:'ProjectName',  text:'Project' });
        
        columns.push({ dataIndex:'EpicOID', text:'Epic', flex: 1, renderer: function(value, meta, record) {
            if ( value == -1 ) { return ""; }
            return Ext.String.format("{0}: {1}", 
                record.get('Epic').FormattedID,
                record.get('Epic').Name
            );
        }});
        
        return columns;
    },
    
    _getBaseRightColumns: function() {
        var columns = [];
        
        columns.push({dataIndex:'PlanEstimate', text:'Sum of Estimates'});
        
        if ( this.getSetting('showEpicPercentage') ) {
            columns.push({dataIndex:'EpicPercentage', text: 'Epic %', renderer: function(value, meta, record){
                if ( !Ext.isNumber(value) || value < 0 ) { return "N/A"; }
                return Ext.util.Format.number(value, '0.##') + "%";
            }});
        }
        columns.push({dataIndex:'c_ExtID01TPR', text:'ExtID: 01 - TPR'});
        
        columns.push({dataIndex:'Iteration',text:'Iteration'});
        return columns;
    },
    
    _getPickableColumns: function() {
        var columns = [],
            me = this;
        var cols = me.getSetting('columnNames') && me.getSetting('columnNames').split(',') || [];

        if ( ! this.epicFields ) { return columns; }
        
        columns = Ext.Array.map(this.epicFields, function(field){            
            return {
                hidden: true,
                dataIndex: 'Epic',
                text:      field.displayName,
                fieldName: field.name,
                renderer: function(value,meta,record) {
                    if ( Ext.isEmpty(value) || Ext.isEmpty(value[field.name]) ) {
                        return "";
                    }
                    if ( Ext.isObject(value[field.name]) ) {
                        return value[field.name]._refObjectName;
                    }
                    return value[field.name];
                }
            };
        });
     
        if ( ! this.pickableColumns ) { return columns; }

        var pickable_by_index = {};
        Ext.Array.each(this.pickableColumns, function(column){
            pickable_by_index[column.fieldName] = column;
        });
        
        return Ext.Array.map(columns, function(column){
            var pickable = pickable_by_index[column.fieldName];
            if ( Ext.isEmpty(pickable) ) { return column; }
            
            if ( !pickable.hidden ) { 
                column.hidden = false;
            } else if(Ext.Array.contains(cols,pickable.fieldName)) {
                column.hidden = false;
            }else{
                column.hidden = true;
            }
            
            return column;
            
        });
    },

   
    _getEpicFields: function() {
        var me = this;
        var deferred = Ext.create('Deft.Deferred');
        Rally.data.ModelFactory.getModel({
            type: 'PortfolioItem',
            success: function(model) {
                var field_list = [];
               
                Ext.Array.each( model.getFields(), function(field) {
                    if ( field.hidden ) { 
                        return;
                    }
                    
                    if ( Ext.Array.contains(me.fields_to_skip,field.name) ) {
                        return;
                    }
                    
                    if ( field.attributeDefinition ) {
                        if ( field.attributeDefinition.AttributeType == "COLLECTION" ||  field.attributeDefinition.AttributeType == "TEXT") {
                            return ;
                        }
                    }
                    field_list.push( field );
                });

                field_list = Ext.Array.sort(field_list, function(a,b){
                    if ( a.DisplayName < b.DisplayName ) { return 1; }
                    if ( a.DisplayName > b.DisplayName ) { return -1; }
                    return 0;    
                });
                deferred.resolve(field_list);
            }
        });
        return deferred.promise;
    }
    
});
