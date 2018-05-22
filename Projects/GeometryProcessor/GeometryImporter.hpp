//////////////////////////////////////////////////////////////////////////
/// Authors: Dane Curbow
/// Copyright 2016, DigiPen Institute of Technology
//////////////////////////////////////////////////////////////////////////
#pragma once

namespace Zero
{

class GeometryImporter
{
public:
  GeometryImporter(String inputFile, String outputPath, String metaFile);
  ~GeometryImporter();

  uint SetupAssimpPostProcess();
  int ProcessModelFiles();

  bool SceneEmpty();
  void CollectNodeData();
  // Returns the unique name of the node, takes the parent nodes name that has potentially been
  // generated/made unique as to properly reference it among nodes with the same name.
  String ExtractDataFromNodesRescursive(aiNode* node, String parentName);
  void SingleMeshHierarchyEntry(HierarchyData& hierarchyData, uint meshIndex);
  void MultipleMeshsHierarchicalEntry(HierarchyData& hierarchyData, aiNode* node);

  void ComputeMeshTransforms();
  bool UpdateBuilderMetaData();

  // If Assimp fails and provides an error message that is not descriptive enough
  // return a new error message that better informs the user of what went wrong
  // if a better message has not been specified return the original message
  String ProcessAssimpErrorMessage(StringParam errorMessage);

  // Zero meta data
  GeometryContent* mGeometryContent;

  // Assimp data
  Assimp::Importer mAssetImporter;
  const aiScene* mScene;
  String mRootNodeName;

  // Provided data
  String mInputFile;
  String mOutputPath;
  String mMetaFile;
  
  // Processed and generated data
  String mBaseMeshName;
  MeshDataMap mMeshDataMap;
  HierarchyDataMap mHierarchyDataMap;

  // An every increasing value appended to node names to result in unique names in the hierarchy
  uint mUniquifyingIndex;
};

}// namespace Zero
